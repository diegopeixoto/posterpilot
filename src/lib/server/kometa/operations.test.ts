import { describe, expect, it } from 'vitest';
import { OPERATIONS, operationByKey, isKnownOperation } from './operations';

describe('kometa/operations', () => {
	it('looks up an operation by key', () => {
		expect(operationByKey('assets_for_all')?.key).toBe('assets_for_all');
		expect(operationByKey('__nope__')).toBeUndefined();
	});

	it('reports whether a key is a known operation', () => {
		expect(isKnownOperation('assets_for_all')).toBe(true);
		expect(isKnownOperation('__nope__')).toBe(false);
	});

	it('has unique operation keys', () => {
		const keys = OPERATIONS.map((o) => o.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
