import { describe, expect, it } from 'vitest';
import { localizeApiError, readLocaleNeutralApiError } from './api-errors';

const localizers = {
	en: {
		known: {
			item_not_found: (params: Readonly<Record<string, unknown>>) =>
				`Item ${String(params.id)} was not found.`
		},
		generic: () => 'Something went wrong. Try again.',
		reference: ({ id }: { id: string }) => `Reference: ${id}`
	},
	pt: {
		known: {
			item_not_found: (params: Readonly<Record<string, unknown>>) =>
				`O item ${String(params.id)} não foi encontrado.`
		},
		generic: () => 'Algo deu errado. Tente novamente.',
		reference: ({ id }: { id: string }) => `Referência: ${id}`
	}
};

describe('locale-neutral API errors', () => {
	it('keeps the API code stable while translating at render time', () => {
		const body = { error: { code: 'item_not_found', params: { id: 42 } } };
		const english = localizeApiError(body, localizers.en);
		const portuguese = localizeApiError(body, localizers.pt);

		expect(english.code).toBe('item_not_found');
		expect(portuguese.code).toBe('item_not_found');
		expect(english.message).toBe('Item 42 was not found.');
		expect(portuguese.message).toBe('O item 42 não foi encontrado.');
		expect(body.error.code).toBe('item_not_found');
	});

	it('uses localized generic copy and preserves only a safe correlation id for unknown codes', () => {
		const body = {
			error: {
				code: 'future_failure',
				params: { detail: 'database URL included super-secret-token' }
			},
			correlationId: 'req_01J2ABC-9'
		};
		const result = localizeApiError(body, localizers.en);

		expect(result).toMatchObject({
			code: 'future_failure',
			message: 'Something went wrong. Try again.',
			correlationId: 'req_01J2ABC-9',
			reference: 'Reference: req_01J2ABC-9'
		});
		expect(JSON.stringify(result)).not.toContain('super-secret-token');
	});

	it('never treats free-form errors or unsafe references as displayable control values', () => {
		const parsed = readLocaleNeutralApiError({
			error: 'network failed with token=secret',
			correlationId: '<script>secret</script>'
		});

		expect(parsed).toEqual({ code: 'unknown_error', params: {}, correlationId: null });
	});
});
