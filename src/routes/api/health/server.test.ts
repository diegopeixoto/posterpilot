import { describe, expect, it } from 'vitest';
import { GET } from './+server';

describe('GET /api/health', () => {
	it('returns 200 with status ok and a non-empty version', async () => {
		// The handler ignores the event; pass a minimal stub.
		const res = (GET as (e: unknown) => Response)({});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { status: string; version: string };
		expect(body.status).toBe('ok');
		expect(typeof body.version).toBe('string');
		expect(body.version.length).toBeGreaterThan(0);
	});
});
