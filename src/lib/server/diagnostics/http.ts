export interface DiagnosticsRequestOptions {
	serverInstanceId: string | null;
}

export type DiagnosticsRequestParseResult =
	| { ok: true; options: DiagnosticsRequestOptions }
	| { ok: false; status: 400; code: 'invalid_request' };

export function parseDiagnosticsRequest(body: unknown): DiagnosticsRequestParseResult {
	if (typeof body !== 'object' || body === null || Array.isArray(body)) {
		return { ok: false, status: 400, code: 'invalid_request' };
	}
	const serverId = (body as Record<string, unknown>).serverId;
	if (serverId !== undefined && typeof serverId !== 'string') {
		return { ok: false, status: 400, code: 'invalid_request' };
	}
	return {
		ok: true,
		options: { serverInstanceId: typeof serverId === 'string' ? serverId.trim() || null : null }
	};
}

export function parseDiagnosticsQuery(url: URL): { serverId: string | undefined; limit: number } {
	const serverId = url.searchParams.get('serverId')?.trim() || undefined;
	const rawLimit = Number(url.searchParams.get('limit') ?? 10);
	return {
		serverId,
		limit: Number.isFinite(rawLimit) ? Math.min(50, Math.max(1, Math.trunc(rawLimit))) : 10
	};
}

/** Map arbitrary exceptions to locale-neutral API state without serializing messages. */
export function diagnosticsError(error: unknown): {
	status: 404 | 500;
	code: 'server_not_found' | 'diagnostics_failed';
} {
	return error && typeof error === 'object' && 'code' in error && error.code === 'server_not_found'
		? { status: 404, code: 'server_not_found' }
		: { status: 500, code: 'diagnostics_failed' };
}
