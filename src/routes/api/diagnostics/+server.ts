import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDiagnostics, runDiagnostics } from '$lib/server/diagnostics';
import {
	diagnosticsError,
	parseDiagnosticsQuery,
	parseDiagnosticsRequest
} from '$lib/server/diagnostics/http';

export const GET: RequestHandler = async ({ url }) => {
	const query = parseDiagnosticsQuery(url);
	return json(await getDiagnostics(query.serverId, query.limit));
};

export const POST: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	const parsed = parseDiagnosticsRequest(body);
	if (!parsed.ok) return json({ error: { code: parsed.code } }, { status: parsed.status });
	const stream =
		typeof body === 'object' &&
		body !== null &&
		!Array.isArray(body) &&
		(body as Record<string, unknown>).stream === true;
	if (stream) {
		const encoder = new TextEncoder();
		let streamOpen = true;
		return new Response(
			new ReadableStream({
				start(controller) {
					const emit = (value: unknown) => {
						if (!streamOpen) return;
						try {
							controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
						} catch {
							streamOpen = false;
						}
					};
					void runDiagnostics({
						...parsed.options,
						onResult: (result) => emit({ type: 'result', result })
					})
						.then((completed) =>
							emit({
								type: 'complete',
								runId: completed.runId,
								status: completed.status
							})
						)
						.catch((error) => emit({ type: 'error', error: diagnosticsError(error).code }))
						.finally(() => {
							if (!streamOpen) return;
							streamOpen = false;
							try {
								controller.close();
							} catch {
								// A disconnected client never cancels the persisted diagnostic run.
							}
						});
				},
				cancel() {
					streamOpen = false;
				}
			}),
			{
				headers: {
					'content-type': 'application/x-ndjson; charset=utf-8',
					'cache-control': 'no-store'
				}
			}
		);
	}
	try {
		return json(await runDiagnostics(parsed.options));
	} catch (error) {
		const mapped = diagnosticsError(error);
		return json({ error: { code: mapped.code } }, { status: mapped.status });
	}
};
