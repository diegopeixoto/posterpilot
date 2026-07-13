import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core';
import * as schema from '$lib/server/db/schema';
import {
	diagnosticResults,
	diagnosticRuns,
	providerStatuses,
	type DiagnosticResult,
	type DiagnosticRun,
	type ProviderStatus
} from '$lib/server/db/schema';
import type { DiagnosticResultValue } from './types';

type Database = LibSQLDatabase<typeof schema>;

export interface DiagnosticHistoryOptions {
	historyPerComponent?: number;
	runsPerScope?: number;
	generateId?: () => string;
	clock?: () => Date;
}

export interface DiagnosticRunWithResults {
	run: DiagnosticRun;
	results: DiagnosticResult[];
}

function scopePredicate(column: AnySQLiteColumn, serverInstanceId: string | null) {
	return serverInstanceId === null ? isNull(column) : eq(column, serverInstanceId);
}

/** Persistence for latest health plus bounded, sanitized diagnostic history. */
export function createDiagnosticHistoryStore(
	database: Database,
	options: DiagnosticHistoryOptions = {}
) {
	const historyPerComponent = Math.max(1, options.historyPerComponent ?? 20);
	const runsPerScope = Math.max(1, options.runsPerScope ?? 30);
	const generateId = options.generateId ?? randomUUID;
	const clock = options.clock ?? (() => new Date());

	async function latest(serverInstanceId?: string | null): Promise<ProviderStatus[]> {
		if (serverInstanceId === undefined) return database.select().from(providerStatuses);
		return database
			.select()
			.from(providerStatuses)
			.where(
				serverInstanceId === null
					? isNull(providerStatuses.serverInstanceId)
					: or(
							isNull(providerStatuses.serverInstanceId),
							eq(providerStatuses.serverInstanceId, serverInstanceId)
						)
			);
	}

	async function start(
		serverInstanceId: string | null,
		initiator = 'user'
	): Promise<DiagnosticRun> {
		const [run] = await database
			.insert(diagnosticRuns)
			.values({
				id: generateId(),
				serverInstanceId,
				initiator,
				status: 'running',
				startedAt: clock()
			})
			.returning();
		return run;
	}

	async function record(runId: string, result: DiagnosticResultValue): Promise<void> {
		await database.transaction(async (tx) => {
			await tx.insert(diagnosticResults).values({ runId, ...result });

			const predicate = and(
				scopePredicate(providerStatuses.serverInstanceId, result.serverInstanceId),
				eq(providerStatuses.componentType, result.componentType),
				eq(providerStatuses.componentKey, result.componentKey)
			);
			const current = (await tx.select().from(providerStatuses).where(predicate).limit(1))[0];
			const statusValue = {
				serverInstanceId: result.serverInstanceId,
				componentType: result.componentType,
				componentKey: result.componentKey,
				status: result.status,
				credentialStatus: result.credentialStatus,
				latencyMs: result.latencyMs,
				lastAttemptAt: result.checkedAt,
				lastSuccessAt: result.lastSuccessAt,
				lastErrorAt: result.errorCode ? result.checkedAt : null,
				errorCode: result.errorCode,
				error: result.error,
				capabilities:
					result.capabilities ?? (result.pathChecks ? { pathChecks: result.pathChecks } : null),
				updatedAt: clock()
			};
			if (current) {
				await tx
					.update(providerStatuses)
					.set(statusValue)
					.where(eq(providerStatuses.id, current.id));
			} else {
				await tx.insert(providerStatuses).values(statusValue);
			}

			const old = await tx
				.select({ id: diagnosticResults.id })
				.from(diagnosticResults)
				.where(
					and(
						scopePredicate(diagnosticResults.serverInstanceId, result.serverInstanceId),
						eq(diagnosticResults.componentType, result.componentType),
						eq(diagnosticResults.componentKey, result.componentKey)
					)
				)
				.orderBy(desc(diagnosticResults.checkedAt), desc(diagnosticResults.id))
				.limit(1_000)
				.offset(historyPerComponent);
			if (old.length) {
				await tx.delete(diagnosticResults).where(
					inArray(
						diagnosticResults.id,
						old.map((row) => row.id)
					)
				);
			}
		});
	}

	async function complete(
		id: string,
		status: 'completed' | 'partial' | 'failed',
		summary: Record<string, unknown>
	): Promise<DiagnosticRun> {
		const current = (
			await database.select().from(diagnosticRuns).where(eq(diagnosticRuns.id, id)).limit(1)
		)[0];
		if (!current) throw new Error('diagnostic_run_not_found');
		const [run] = await database
			.update(diagnosticRuns)
			.set({ status, summary, completedAt: clock() })
			.where(eq(diagnosticRuns.id, id))
			.returning();

		const oldRuns = await database
			.select({ id: diagnosticRuns.id })
			.from(diagnosticRuns)
			.where(
				current.serverInstanceId === null
					? isNull(diagnosticRuns.serverInstanceId)
					: eq(diagnosticRuns.serverInstanceId, current.serverInstanceId)
			)
			.orderBy(desc(diagnosticRuns.startedAt))
			.limit(1_000)
			.offset(runsPerScope);
		if (oldRuns.length) {
			await database.delete(diagnosticRuns).where(
				inArray(
					diagnosticRuns.id,
					oldRuns.map((row) => row.id)
				)
			);
		}
		return run;
	}

	async function history(
		limit = 10,
		serverInstanceId?: string
	): Promise<DiagnosticRunWithResults[]> {
		const bounded = Math.min(50, Math.max(1, Math.trunc(limit)));
		const runs = await database
			.select()
			.from(diagnosticRuns)
			.where(
				serverInstanceId
					? or(
							isNull(diagnosticRuns.serverInstanceId),
							eq(diagnosticRuns.serverInstanceId, serverInstanceId)
						)
					: undefined
			)
			.orderBy(desc(diagnosticRuns.startedAt))
			.limit(bounded);
		if (!runs.length) return [];
		const results = await database
			.select()
			.from(diagnosticResults)
			.where(
				inArray(
					diagnosticResults.runId,
					runs.map((run) => run.id)
				)
			)
			.orderBy(desc(diagnosticResults.checkedAt));
		return runs.map((run) => ({
			run,
			results: results.filter(
				(result) =>
					result.runId === run.id &&
					(!serverInstanceId ||
						result.serverInstanceId === null ||
						result.serverInstanceId === serverInstanceId)
			)
		}));
	}

	return { latest, start, record, complete, history };
}

export type DiagnosticHistoryStore = ReturnType<typeof createDiagnosticHistoryStore>;
