import { describe, expect, it } from 'vitest';
import { diagnosticsError, parseDiagnosticsQuery, parseDiagnosticsRequest } from './http';

describe('diagnostics API input', () => {
	it('normalizes optional scope and bounds history limits', () => {
		expect(parseDiagnosticsRequest({ serverId: ' server-1 ' })).toEqual({
			ok: true,
			options: { serverInstanceId: 'server-1' }
		});
		expect(
			parseDiagnosticsQuery(new URL('http://localhost/api/diagnostics?serverId=s&limit=999'))
		).toEqual({ serverId: 's', limit: 50 });
	});

	it('rejects malformed bodies without passing raw state through', () => {
		expect(parseDiagnosticsRequest({ serverId: 7 })).toEqual({
			ok: false,
			status: 400,
			code: 'invalid_request'
		});
		expect(parseDiagnosticsRequest([])).toMatchObject({ ok: false });
	});

	it('maps arbitrary failures to safe locale-neutral codes', () => {
		expect(diagnosticsError({ code: 'server_not_found', message: 'secret' })).toEqual({
			status: 404,
			code: 'server_not_found'
		});
		expect(diagnosticsError(new Error('token=secret'))).toEqual({
			status: 500,
			code: 'diagnostics_failed'
		});
	});
});
