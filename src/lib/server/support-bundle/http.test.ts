import { describe, expect, it } from 'vitest';
import { parseSupportBundleRequest } from './http';

describe('support bundle request', () => {
	it('requires an explicit confirmation and opt-in for titles', () => {
		expect(parseSupportBundleRequest({})).toEqual({
			ok: false,
			status: 400,
			code: 'confirmation_required'
		});
		expect(parseSupportBundleRequest({ confirmed: true })).toEqual({
			ok: true,
			includeTitles: false
		});
		expect(parseSupportBundleRequest({ confirmed: true, includeTitles: true })).toEqual({
			ok: true,
			includeTitles: true
		});
	});

	it('rejects ambiguous title inclusion values', () => {
		expect(parseSupportBundleRequest({ confirmed: true, includeTitles: 'yes' })).toMatchObject({
			ok: false,
			code: 'invalid_request'
		});
	});
});
