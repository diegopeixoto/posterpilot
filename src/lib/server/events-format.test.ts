import { describe, expect, it } from 'vitest';
import { formatEventLine } from './events-format';

describe('formatEventLine', () => {
	it('formats a bare event without context', () => {
		expect(formatEventLine('info', 'sync', 'Library sync started')).toBe(
			'[info] sync: Library sync started'
		);
	});

	it('appends serialized context when present', () => {
		expect(
			formatEventLine('error', 'apply', 'Apply failed', { title: 'Dune', method: 'plex' })
		).toBe('[error] apply: Apply failed {"title":"Dune","method":"plex"}');
	});

	it('omits null/undefined context', () => {
		expect(formatEventLine('warn', 'discover', 'No covers', null)).toBe(
			'[warn] discover: No covers'
		);
		expect(formatEventLine('warn', 'discover', 'No covers', undefined)).toBe(
			'[warn] discover: No covers'
		);
	});

	it('falls back to String() for non-serializable context', () => {
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		expect(formatEventLine('warn', 'provider', 'oops', circular)).toBe(
			'[warn] provider: oops [object Object]'
		);
	});
});
