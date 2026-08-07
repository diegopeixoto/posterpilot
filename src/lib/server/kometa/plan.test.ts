import { describe, expect, it } from 'vitest';
import {
	assertKometaConfigPlanPayload,
	kometaFileFingerprint,
	kometaProposedFingerprint,
	rawKometaChanges,
	safeYamlPreviewLines,
	type KometaConfigPlanPayload
} from './plan';

describe('Kometa mutation plan helpers', () => {
	it('distinguishes an absent file from an empty file', () => {
		expect(kometaFileFingerprint(null)).not.toBe(kometaFileFingerprint(''));
		expect(kometaFileFingerprint('a: 1')).toMatch(/^[0-9a-f]{64}$/);
	});

	it('redacts built-in, connector, and secret-looking raw YAML values', () => {
		const webhook = 'https://discord.com/api/webhooks/123/secret-token';
		const safe = safeYamlPreviewLines(
			[
				'plex:',
				'  url: http://plex',
				'  token: plex-secret',
				'trakt:',
				'  client_secret: trakt-secret',
				'custom:',
				'  password: custom-secret',
				'  label: visible',
				'webhooks:',
				`  error: ${webhook}`,
				`  run_start: ${webhook}`,
				`  run_end: ${webhook}`
			].join('\n')
		).join('\n');
		expect(safe).toContain('url: ***');
		expect(safe).not.toContain('http://plex');
		expect(safe).toContain('label: visible');
		expect(safe).not.toContain('plex-secret');
		expect(safe).not.toContain('trakt-secret');
		expect(safe).not.toContain('custom-secret');
		expect(safe).not.toContain(webhook);
	});

	it('redacts URL-shaped values even when their key is not secret-looking', () => {
		const url = 'https://plex.example.test/library?token=sensitive';
		const safe = safeYamlPreviewLines(`plex:\n  address: ${url}\n  mirrors:\n    - ${url}\n`);

		expect(JSON.stringify(safe)).not.toContain(url);
		expect(safe).toContain('  address: ***');
		expect(safe).toContain('    - ***');
	});

	it('redacts custom credentials, authorization values, cookies, and private-key blocks', () => {
		const privateLine = 'not-safe-private-material';
		const safe = safeYamlPreviewLines(
			[
				'custom:',
				'  credential: opaque-credential',
				'  authorization: Bearer opaque-bearer-token',
				'  cookie: session=opaque-cookie',
				'  private_key: |',
				'    -----BEGIN PRIVATE KEY-----',
				`    ${privateLine}`,
				'    -----END PRIVATE KEY-----',
				'  visible: retained'
			].join('\n')
		).join('\n');

		expect(safe).not.toContain('opaque-credential');
		expect(safe).not.toContain('opaque-bearer-token');
		expect(safe).not.toContain('opaque-cookie');
		expect(safe).not.toContain('BEGIN PRIVATE KEY');
		expect(safe).not.toContain(privateLine);
		expect(safe).toContain('visible: retained');
	});

	it('redacts tagged, anchored, and commented secret block scalars', () => {
		const binarySecret = 'c2VjcmV0LWJ5dGVz';
		const anchoredSecret = 'folded-secret-material';
		const safe = safeYamlPreviewLines(
			[
				'custom:',
				'  token: !!binary |',
				`    ${binarySecret}`,
				'  private_key: &vault >- # encrypted material',
				`    ${anchoredSecret}`,
				'  visible: retained'
			].join('\n')
		).join('\n');

		expect(safe).not.toContain(binarySecret);
		expect(safe).not.toContain(anchoredSecret);
		expect(safe).toContain('token: ***');
		expect(safe).toContain('private_key: ***');
		expect(safe).toContain('visible: retained');
	});

	it('does not expose an unchanged block secret between two rollback diff changes', () => {
		const privateLine = 'unchanged-private-material';
		const before = [
			'libraries:',
			'  A: legacy',
			'private_key: |',
			'  -----BEGIN PRIVATE KEY-----',
			`  ${privateLine}`,
			'  -----END PRIVATE KEY-----',
			'B: legacy'
		].join('\n');
		const after = before.replaceAll('legacy', 'typed');

		const preview = rawKometaChanges(before, after);

		expect(JSON.stringify(preview)).not.toContain('BEGIN PRIVATE KEY');
		expect(JSON.stringify(preview)).not.toContain(privateLine);
	});

	it('never includes a webhook URL in a raw diff preview', () => {
		const webhook = 'https://discord.com/api/webhooks/123/secret-token';
		const out = rawKometaChanges(
			'webhooks:\n  error: https://old.invalid/hook\n',
			`webhooks:\n  error: ${webhook}\n`
		);
		expect(JSON.stringify(out)).not.toContain(webhook);
		expect(out.changes).toContainEqual(
			expect.objectContaining({ before: '  error: ***', after: '  error: ***' })
		);
	});

	it('produces a bounded display diff without changing exact fingerprints', () => {
		const out = rawKometaChanges('settings:\n  cache: true\n', 'settings:\n  cache: false\n');
		expect(out).toEqual({
			changes: [
				{
					op: 'modify',
					path: 'line 2',
					before: '  cache: true',
					after: '  cache: false'
				}
			],
			truncated: false
		});
	});

	it('validates the exact proposed content bound into a plan', () => {
		const content = 'settings:\n  cache: true\n';
		const payload: KometaConfigPlanPayload = {
			type: 'kometa_config_mutation',
			version: 1,
			action: 'raw',
			serverInstanceId: 'server-a',
			serverName: 'Plex A',
			configPath: '/config/config.yml',
			mode: 'merge',
			sourceFingerprint: kometaFileFingerprint(''),
			proposedFingerprint: kometaProposedFingerprint(content),
			proposedContent: content,
			display: {
				changes: [],
				warnings: [],
				dropped: [],
				consistency: [],
				willScaffold: false
			},
			structured: null,
			restore: null
		};
		expect(() => assertKometaConfigPlanPayload(payload)).not.toThrow();
		payload.proposedContent += '# changed';
		expect(() => assertKometaConfigPlanPayload(payload)).toThrow(/fingerprint/);
	});
});
