import type { Client } from '@libsql/client';

export const READINESS_TIMEOUT_MS = 2_000;

export type DatabaseReadiness =
	| { status: 'ready'; latencyMs: number }
	| { status: 'not_ready'; reason: 'timeout' | 'query_failed'; latencyMs: number };

let readinessQuery: Promise<unknown> | null = null;

function sharedReadinessQuery(client: Pick<Client, 'execute'>): Promise<unknown> {
	if (readinessQuery) return readinessQuery;
	readinessQuery = client.execute('select 1 as ready').finally(() => {
		readinessQuery = null;
	});
	return readinessQuery;
}

export async function checkDatabaseReadiness(
	client: Pick<Client, 'execute'>,
	timeoutMs = READINESS_TIMEOUT_MS,
	onFailure?: (error: unknown) => void
): Promise<DatabaseReadiness> {
	const started = performance.now();
	let timer: ReturnType<typeof setTimeout> | undefined;
	try {
		const timeout = new Promise<never>((_, reject) => {
			timer = setTimeout(() => reject(new Error('readiness_timeout')), timeoutMs);
		});
		// Reuse a still-running query so repeated orchestrator probes cannot create
		// an unbounded queue when the database driver itself is wedged.
		await Promise.race([sharedReadinessQuery(client), timeout]);
		return { status: 'ready', latencyMs: Math.round(performance.now() - started) };
	} catch (error) {
		onFailure?.(error);
		return {
			status: 'not_ready',
			reason:
				error instanceof Error && error.message === 'readiness_timeout'
					? 'timeout'
					: 'query_failed',
			latencyMs: Math.round(performance.now() - started)
		};
	} finally {
		if (timer) clearTimeout(timer);
	}
}
