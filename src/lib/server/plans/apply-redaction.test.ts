import { describe, expect, it } from 'vitest';
import { redactApplyErrorText, redactSensitiveArtworkUrl } from './apply-redaction';

describe('apply output redaction', () => {
	it('removes basic auth and media-server query credentials', () => {
		const redacted = redactSensitiveArtworkUrl(
			'https://user:password@server.example/poster?X-Plex-Token=secret&width=300'
		);
		expect(redacted).not.toContain('user');
		expect(redacted).not.toContain('password');
		expect(redacted).not.toContain('secret');
		expect(redacted).toContain('width=300');
	});

	it('sanitizes credential-bearing URLs embedded in provider errors', () => {
		const redacted = redactApplyErrorText(
			'Could not fetch https://server.example/image?api_key=top-secret&x=1'
		);
		expect(redacted).not.toContain('top-secret');
		expect(redacted).toContain('x=1');
	});
});
