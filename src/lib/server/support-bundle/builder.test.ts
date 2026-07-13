import { describe, expect, it } from 'vitest';
import { buildSupportBundle } from './builder';
import { sanitizeSupportEntry, SUPPORT_REDACTION } from './sanitize';

function tarEntries(archive: Buffer): Map<string, Buffer> {
	const entries = new Map<string, Buffer>();
	let offset = 0;
	while (offset + 512 <= archive.length) {
		const header = archive.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/s, '');
		const size = Number.parseInt(
			header.subarray(124, 136).toString('ascii').replace(/\0.*$/s, '').trim() || '0',
			8
		);
		const start = offset + 512;
		entries.set(name, archive.subarray(start, start + size));
		offset = start + Math.ceil(size / 512) * 512;
	}
	return entries;
}

describe('support bundle sanitization', () => {
	it('redacts known and credential-shaped secrets in nested values and URLs', () => {
		const sanitized = sanitizeSupportEntry(
			{
				headers: { authorization: 'Bearer secret-bearer' },
				error: 'failed https://user:pass@example.test/a?api_key=other-secret',
				payload: { token: 'known-secret', safe: 'ok' }
			},
			['known-secret', 'secret-bearer', 'other-secret']
		);
		const text = JSON.stringify(sanitized);
		expect(text).not.toContain('known-secret');
		expect(text).not.toContain('secret-bearer');
		expect(text).not.toContain('other-secret');
		expect(text).not.toContain('user:pass');
		expect(text).toContain(SUPPORT_REDACTION);
		expect(text).toContain('"safe":"ok"');
	});

	it('redacts AWS credentials, signatures, and percent-encoded secret query keys', () => {
		const accessKey = `AKIA${'A'.repeat(16)}`;
		const signature = 'deadbeefsecret';
		const sanitized = sanitizeSupportEntry({
			url: `https://provider.test/image?X-Amz-Credential=${accessKey}%2Fscope&X%2DAmz%2DSignature=${signature}&width=300`,
			error: `signature: ${signature}`,
			nested: { 'X-Amz-Credential': accessKey, safe: 'retained' }
		});
		const text = JSON.stringify(sanitized);
		expect(text).not.toContain(accessKey);
		expect(text).not.toContain(signature);
		expect(text).toContain('width=300');
		expect(text).toContain('retained');
		expect(text).toContain(SUPPORT_REDACTION);
	});

	it('omits optional entries when sanitization cannot prove them safe', () => {
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		const bundle = buildSupportBundle({
			appVersion: '1.2.3',
			generatedAt: new Date('2026-07-10T12:00:00Z'),
			includeTitles: false,
			sources: [
				{ path: 'runtime.json', value: { platform: 'linux' } },
				{ path: 'optional.json', value: cyclic, optional: true }
			]
		});
		expect(bundle.manifest.omissions).toEqual([{ path: 'optional.json', reason: 'cyclic' }]);
		const entries = tarEntries(bundle.bytes);
		expect([...entries.keys()]).toEqual(['manifest.json', 'runtime.json']);
		expect(JSON.parse(entries.get('manifest.json')!.toString())).toMatchObject({
			format: 'posterpilot-support-v1',
			titlesIncluded: false
		});
	});

	it('never includes titles unless the caller explicitly supplies the title entry', () => {
		const without = buildSupportBundle({
			appVersion: '1',
			generatedAt: new Date('2026-07-10T12:00:00Z'),
			includeTitles: false,
			sources: [{ path: 'jobs.json', value: [{ id: 1, status: 'failed' }] }]
		});
		expect(without.bytes.toString()).not.toContain('Private Movie');
		const withTitles = buildSupportBundle({
			appVersion: '1',
			generatedAt: new Date('2026-07-10T12:00:00Z'),
			includeTitles: true,
			sources: [{ path: 'titles.json', value: [{ title: 'Private Movie' }] }]
		});
		expect(withTitles.bytes.toString()).toContain('Private Movie');
	});
});
