import { describe, expect, it } from 'vitest';
import { canonicalPathAfterServerSwitch } from './server-context-navigation';

describe('canonicalPathAfterServerSwitch', () => {
	it('drops stale review, FUN and library query state', () => {
		for (const path of [
			'/review?server=old&view=saved&job=42',
			'/fun/session?server=old&library=movies&plan=seed',
			'/library?genre=Drama&q=title'
		]) {
			const url = new URL(path, 'http://posterpilot.test');
			expect(canonicalPathAfterServerSwitch(url)).toBe(url.pathname);
		}
	});

	it('leaves invalid item and collection identities behind', () => {
		expect(
			canonicalPathAfterServerSwitch(new URL('/item/42?returnTo=%2Freview', 'http://test'))
		).toBe('/library');
		expect(canonicalPathAfterServerSwitch(new URL('/collections/tmdb%3A9', 'http://test'))).toBe(
			'/collections'
		);
	});

	it('preserves only a valid global Settings tab', () => {
		expect(
			canonicalPathAfterServerSwitch(new URL('/settings?tab=automation&server=old', 'http://test'))
		).toBe('/settings?tab=automation');
		expect(canonicalPathAfterServerSwitch(new URL('/settings?tab=unknown', 'http://test'))).toBe(
			'/settings'
		);
	});
});
