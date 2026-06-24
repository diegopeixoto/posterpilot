import { describe, it, expect } from 'vitest';
import { buildUpdateInfo, RELEASES_PAGE, type GhRelease } from './update-info';

const latest = (over: Partial<GhRelease> = {}): GhRelease => ({
	tag_name: 'v0.4.0',
	html_url: 'https://github.com/diegopeixoto/posterpilot/releases/tag/v0.4.0',
	name: 'v0.4.0',
	body: '## 0.4.0\n- new stuff',
	...over
});

const current = (over: Partial<GhRelease> = {}): GhRelease => ({
	tag_name: 'v0.3.0',
	html_url: 'https://github.com/diegopeixoto/posterpilot/releases/tag/v0.3.0',
	name: 'v0.3.0',
	body: '## 0.3.0\n- running version notes',
	...over
});

describe('buildUpdateInfo', () => {
	it('returns the safe base when both responses are null', () => {
		const info = buildUpdateInfo('0.3.0', null, null);
		expect(info).toEqual({
			current: '0.3.0',
			latest: null,
			updateAvailable: false,
			url: RELEASES_PAGE,
			name: null,
			body: null,
			currentName: null,
			currentBody: null,
			currentUrl: RELEASES_PAGE,
			currentResolved: false
		});
	});

	it('flags an available update when latest is newer and maps its fields', () => {
		const info = buildUpdateInfo('0.3.0', latest(), null);
		expect(info.latest).toBe('0.4.0');
		expect(info.updateAvailable).toBe(true);
		expect(info.name).toBe('v0.4.0');
		expect(info.body).toContain('new stuff');
		expect(info.url).toBe('https://github.com/diegopeixoto/posterpilot/releases/tag/v0.4.0');
	});

	it('does not flag an update when latest equals the running version', () => {
		const info = buildUpdateInfo('0.4.0', latest(), null);
		expect(info.latest).toBe('0.4.0');
		expect(info.updateAvailable).toBe(false);
	});

	it('does not flag an update when latest is older than the running version', () => {
		const info = buildUpdateInfo('0.5.0', latest(), null);
		expect(info.updateAvailable).toBe(false);
	});

	it('strips a leading v from the tag (case-insensitive)', () => {
		expect(buildUpdateInfo('0.3.0', latest({ tag_name: 'V0.4.0' }), null).latest).toBe('0.4.0');
		expect(buildUpdateInfo('0.3.0', latest({ tag_name: '0.4.0' }), null).latest).toBe('0.4.0');
	});

	it('maps the running version release into the current* fields', () => {
		const info = buildUpdateInfo('0.3.0', null, current());
		expect(info.currentName).toBe('v0.3.0');
		expect(info.currentBody).toContain('running version notes');
		expect(info.currentUrl).toBe('https://github.com/diegopeixoto/posterpilot/releases/tag/v0.3.0');
	});

	it('treats empty / whitespace name and body as null', () => {
		const info = buildUpdateInfo(
			'0.3.0',
			latest({ name: '   ', body: '' }),
			current({ name: '', body: '  ' })
		);
		expect(info.name).toBeNull();
		expect(info.body).toBeNull();
		expect(info.currentName).toBeNull();
		expect(info.currentBody).toBeNull();
	});

	it('falls back to the releases page when html_url is missing', () => {
		const info = buildUpdateInfo(
			'0.3.0',
			latest({ html_url: undefined }),
			current({ html_url: undefined })
		);
		expect(info.url).toBe(RELEASES_PAGE);
		expect(info.currentUrl).toBe(RELEASES_PAGE);
	});

	it('keeps current notes intact when only the latest request fails', () => {
		const info = buildUpdateInfo('0.3.0', null, current());
		expect(info.latest).toBeNull();
		expect(info.updateAvailable).toBe(false);
		expect(info.currentBody).toContain('running version notes');
	});

	it('reports currentResolved per whether the running version release was found', () => {
		expect(buildUpdateInfo('0.3.0', latest(), current()).currentResolved).toBe(true);
		// A resolved release with empty notes still counts as resolved.
		expect(
			buildUpdateInfo('0.3.0', latest(), current({ body: '', name: '' })).currentResolved
		).toBe(true);
		// Tag lookup failed → not resolved (client should retry, not mark seen).
		expect(buildUpdateInfo('0.3.0', latest(), null).currentResolved).toBe(false);
	});

	it('treats a missing tag_name as no known latest', () => {
		const info = buildUpdateInfo('0.3.0', latest({ tag_name: undefined }), null);
		expect(info.latest).toBeNull();
		expect(info.updateAvailable).toBe(false);
	});
});
