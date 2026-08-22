import { describe, expect, it } from 'vitest';
import { fullPageTargetForNewBuild } from './client-update';

const to = { url: new URL('http://posterpilot.local/item/42?review=1') };

describe('Full-page navigation after a new build is detected', () => {
	it('turns a client-side navigation into a full-page load of the same target once a newer build is serving', () => {
		expect(fullPageTargetForNewBuild(true, { willUnload: false, to })).toBe(
			'http://posterpilot.local/item/42?review=1'
		);
	});

	it('leaves navigation alone while the loaded bundle is still the current build', () => {
		expect(fullPageTargetForNewBuild(false, { willUnload: false, to })).toBeNull();
	});

	it('does not interfere with a navigation that already unloads the page', () => {
		expect(fullPageTargetForNewBuild(true, { willUnload: true, to })).toBeNull();
	});

	it('has nowhere to reload to when the navigation has no destination', () => {
		expect(fullPageTargetForNewBuild(true, { willUnload: false, to: null })).toBeNull();
	});
});
