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
		expect(safe).toContain('url: http://plex');
		expect(safe).toContain('label: visible');
		expect(safe).not.toContain('plex-secret');
		expect(safe).not.toContain('trakt-secret');
		expect(safe).not.toContain('custom-secret');
		expect(safe).not.toContain(webhook);
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
