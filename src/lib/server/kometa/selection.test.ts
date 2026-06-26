import { describe, it, expect } from 'vitest';
import { parseSelectionInput } from './selection';

describe('parseSelectionInput', () => {
	it('returns empty selections for junk input', () => {
		expect(parseSelectionInput(null)).toEqual({ libraries: [], defaults: {}, settings: {} });
		expect(parseSelectionInput('nope')).toEqual({ libraries: [], defaults: {}, settings: {} });
		expect(parseSelectionInput({ libraries: 'x' })).toEqual({
			libraries: [],
			defaults: {},
			settings: {}
		});
	});

	it('coerces a well-formed body', () => {
		const out = parseSelectionInput({
			libraries: [1, '2'],
			defaults: { '1': ['genre', 5], bad: 'no' },
			settings: { asset_directory: '/a', n: 3 }
		});
		expect(out.libraries).toEqual(['1', '2']);
		expect(out.defaults).toEqual({ '1': ['genre', '5'] });
		expect(out.settings).toEqual({ asset_directory: '/a' });
	});
});
