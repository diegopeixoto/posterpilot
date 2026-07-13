export type SupportBundleRequest =
	| { ok: true; includeTitles: boolean }
	| { ok: false; status: 400; code: 'invalid_request' | 'confirmation_required' };

export function parseSupportBundleRequest(value: unknown): SupportBundleRequest {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		return { ok: false, status: 400, code: 'invalid_request' };
	}
	const input = value as Record<string, unknown>;
	if (input.confirmed !== true) {
		return { ok: false, status: 400, code: 'confirmation_required' };
	}
	if (input.includeTitles !== undefined && typeof input.includeTitles !== 'boolean') {
		return { ok: false, status: 400, code: 'invalid_request' };
	}
	return { ok: true, includeTitles: input.includeTitles === true };
}
