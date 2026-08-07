import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ recover: vi.fn() }));

vi.mock('$lib/server/kometa/config-mutation-recovery', () => {
	class KometaConfigMutationRecoveryError extends Error {
		constructor(readonly code: string) {
			super(code);
			this.name = 'KometaConfigMutationRecoveryError';
		}
	}
	return {
		KometaConfigMutationRecoveryError,
		recoverPendingKometaConfigMutation: h.recover
	};
});

import { KometaConfigMutationRecoveryError } from '$lib/server/kometa/config-mutation-recovery';
import { POST } from './+server';

type PostHandler = (event: { request: Request }) => Promise<Response>;

function event(body?: string): { request: Request } {
	return {
		request: new Request('http://localhost/api/kometa/config/recover', {
			method: 'POST',
			...(body === undefined ? {} : { body, headers: { 'content-type': 'application/json' } })
		})
	};
}

async function call(body?: string): Promise<Response> {
	return (POST as PostHandler)(event(body));
}

describe('POST /api/kometa/config/recover', () => {
	beforeEach(() => h.recover.mockReset());

	it.each([
		['an empty request', undefined],
		['an empty object', '{}']
	])('accepts %s', async (_label, body) => {
		h.recover.mockResolvedValue({ recovered: true, resolution: 'completed', action: 'raw' });

		const response = await call(body);

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual({
			recovered: true,
			resolution: 'completed',
			action: 'raw'
		});
		expect(h.recover).toHaveBeenCalledOnce();
	});

	it('rejects any recovery options or malformed JSON before calling the service', async () => {
		for (const body of ['{"force":true}', '{']) {
			const response = await call(body);
			expect(response.status).toBe(400);
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(await response.json()).toEqual({ error: { code: 'invalid_request' } });
		}
		expect(h.recover).not.toHaveBeenCalled();
	});

	it('maps bounded recovery failures to conflict responses', async () => {
		h.recover.mockImplementationOnce(async () => {
			throw new KometaConfigMutationRecoveryError('kometa_config_recovery_ambiguous');
		});

		const response = await call();

		expect(response.status).toBe(409);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual({
			error: { code: 'kometa_config_recovery_ambiguous' }
		});
	});

	it('redacts unexpected exception details', async () => {
		h.recover.mockImplementationOnce(async () => {
			throw new Error('secret checkpoint payload');
		});

		const response = await call();

		expect(response.status).toBe(500);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		const text = await response.text();
		expect(JSON.parse(text)).toEqual({
			error: { code: 'kometa_config_recovery_failed' }
		});
		expect(text).not.toContain('secret checkpoint payload');
	});
});
