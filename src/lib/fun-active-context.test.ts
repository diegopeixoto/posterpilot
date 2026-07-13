import { describe, expect, it } from 'vitest';
import { canonicalFunActiveUrl } from './fun-active-context';

describe('canonicalFunActiveUrl', () => {
	it('removes a local server override while preserving active-scope filters', () => {
		const url = new URL('http://posterpilot.test/fun?server=old&library=movies&type=movie');
		expect(canonicalFunActiveUrl(url, new Set(['movies']))).toBe('/fun?library=movies&type=movie');
	});

	it('drops a library that does not exist on the active server', () => {
		const url = new URL('http://posterpilot.test/fun/session?library=old-library&genre=Drama');
		expect(canonicalFunActiveUrl(url, new Set(['movies']))).toBe('/fun/session?genre=Drama');
	});

	it('does not redirect an already canonical URL', () => {
		const url = new URL('http://posterpilot.test/fun/gallery?library=movies');
		expect(canonicalFunActiveUrl(url, new Set(['movies']))).toBeNull();
	});
});
