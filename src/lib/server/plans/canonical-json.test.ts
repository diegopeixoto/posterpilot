import { describe, expect, it } from 'vitest';
import {
	CanonicalJsonError,
	canonicalJson,
	canonicalJsonDigest,
	hashCanonicalJson
} from './canonical-json';

describe('canonicalJson', () => {
	it('sorts object keys recursively while preserving array order', () => {
		const first = {
			z: [{ beta: 2, alpha: 1 }, 3],
			a: { y: true, x: null }
		};
		const second = {
			a: { x: null, y: true },
			z: [{ alpha: 1, beta: 2 }, 3]
		};

		expect(canonicalJson(first)).toBe('{"a":{"x":null,"y":true},"z":[{"alpha":1,"beta":2},3]}');
		expect(canonicalJson(second)).toBe(canonicalJson(first));
	});

	it('uses JSON string escaping and canonical number rendering', () => {
		expect(canonicalJson({ text: 'line\n"quoted"', negativeZero: -0, decimal: 1.5 })).toBe(
			'{"decimal":1.5,"negativeZero":0,"text":"line\\n\\"quoted\\""}'
		);
	});

	it('does not mutate the value it canonicalizes', () => {
		const value = { z: 1, a: 2 };
		expect(canonicalJson(value)).toBe('{"a":2,"z":1}');
		expect(Object.keys(value)).toEqual(['z', 'a']);
	});

	it.each([
		['undefined', undefined],
		['non-finite number', Number.NaN],
		['positive infinity', Number.POSITIVE_INFINITY],
		['bigint', 1n],
		['function', () => undefined],
		['date', new Date('2026-01-01T00:00:00Z')],
		['nested undefined', { value: undefined }]
	])('rejects %s rather than silently coercing it', (_label, value) => {
		expect(() => canonicalJson(value)).toThrow(CanonicalJsonError);
	});

	it('rejects sparse arrays', () => {
		const sparse = new Array(2);
		sparse[1] = 'present';
		expect(() => canonicalJson(sparse)).toThrow(/Sparse arrays/);
	});

	it('rejects circular references and reports their path', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(() => canonicalJson(circular)).toThrow(/Circular references.*\$\.self/);
	});
});

describe('canonical JSON hashing', () => {
	it('produces the known SHA-256 digest for canonical JSON', () => {
		expect(hashCanonicalJson({ b: 2, a: 1 })).toBe(
			'43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777'
		);
	});

	it('returns identical hashes for semantically identical key orderings', () => {
		expect(hashCanonicalJson({ nested: { b: 2, a: 1 }, ok: true })).toBe(
			hashCanonicalJson({ ok: true, nested: { a: 1, b: 2 } })
		);
	});

	it('returns canonical text and its digest together', () => {
		expect(canonicalJsonDigest(['poster', { id: 42 }])).toEqual({
			canonicalJson: '["poster",{"id":42}]',
			digest: '27fd61adc9f5d35569ac37682f6d6c8c08807b8a6cf3e18041233f3e96c62cea'
		});
	});
});
