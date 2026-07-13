import { describe, expect, it } from 'vitest';
import { sha256Bytes, verifyServerArtworkRead } from './verification';

const bytes = (value: string) => new TextEncoder().encode(value);
const artwork = (value: string, identity: string | null) => ({
	kind: 'poster' as const,
	url: null,
	identity,
	data: bytes(value).buffer,
	contentType: 'image/jpeg'
});

describe('server artwork verification', () => {
	it('reports exact when the served bytes match the intended image', () => {
		const expected = sha256Bytes(bytes('new'));
		expect(
			verifyServerArtworkRead({
				beforeIdentity: 'old-id',
				beforeSha256: sha256Bytes(bytes('old')),
				expectedSha256: expected,
				after: artwork('new', 'new-id')
			})
		).toMatchObject({ ok: true, verification: 'exact', observedFingerprint: expected });
	});

	it('uses best-effort evidence when a provider transcodes but advances identity', () => {
		expect(
			verifyServerArtworkRead({
				beforeIdentity: 'old-id',
				beforeSha256: sha256Bytes(bytes('old')),
				expectedSha256: sha256Bytes(bytes('source')),
				after: artwork('transcoded-source', 'new-id')
			})
		).toMatchObject({ ok: true, verification: 'best_effort' });
	});

	it('fails when the server still serves the prior image or no image', () => {
		const prior = sha256Bytes(bytes('old'));
		expect(
			verifyServerArtworkRead({
				beforeIdentity: 'old-id',
				beforeSha256: prior,
				expectedSha256: sha256Bytes(bytes('new')),
				after: artwork('old', 'old-id')
			})
		).toMatchObject({ ok: false, verification: 'mismatch' });
		expect(
			verifyServerArtworkRead({
				beforeIdentity: null,
				beforeSha256: null,
				expectedSha256: null,
				after: null
			})
		).toMatchObject({ ok: false, errorCode: 'artwork_missing_after_write' });
	});
});
