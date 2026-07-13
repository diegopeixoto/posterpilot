import { createHash } from 'node:crypto';
import type { ServerArtwork } from '$lib/server/media-server';

export type ArtworkVerification = 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';

export interface ArtworkVerificationResult {
	ok: boolean;
	verification: ArtworkVerification;
	observedFingerprint: string | null;
	errorCode: string | null;
	error: string | null;
}

export function sha256Bytes(data: ArrayBuffer | Uint8Array): string {
	const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
	return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Classify a fresh, uncached server read after a write. Exact byte equality wins;
 * providers that transcode may still provide best-effort evidence when their native
 * identity or served bytes changed from the captured prior state.
 */
export function verifyServerArtworkRead(input: {
	beforeState?: 'present' | 'absent' | 'unavailable';
	beforeIdentity: string | null;
	beforeSha256: string | null;
	expectedSha256: string | null;
	after: ServerArtwork | null;
}): ArtworkVerificationResult {
	if (input.beforeState === 'unavailable') {
		return unavailableArtworkVerification();
	}
	if (!input.after || input.after.data.byteLength === 0) {
		return {
			ok: false,
			verification: 'mismatch',
			observedFingerprint: null,
			errorCode: 'artwork_missing_after_write',
			error: 'Artwork was not readable after the server accepted the write.'
		};
	}
	const observedFingerprint = sha256Bytes(input.after.data);
	if (input.expectedSha256 && observedFingerprint === input.expectedSha256) {
		return {
			ok: true,
			verification: 'exact',
			observedFingerprint,
			errorCode: null,
			error: null
		};
	}
	if (input.beforeState === 'absent') {
		return {
			ok: true,
			verification: 'best_effort',
			observedFingerprint,
			errorCode: null,
			error: null
		};
	}
	const identityChanged =
		input.after.identity !== null && input.after.identity !== input.beforeIdentity;
	const bytesChanged = input.beforeSha256 !== null && observedFingerprint !== input.beforeSha256;
	if (identityChanged || bytesChanged) {
		return {
			ok: true,
			verification: 'best_effort',
			observedFingerprint,
			errorCode: null,
			error: null
		};
	}
	return {
		ok: false,
		verification: 'mismatch',
		observedFingerprint,
		errorCode: 'artwork_unchanged_after_write',
		error: 'The server still exposes the prior artwork after the write.'
	};
}

export function unavailableArtworkVerification(error?: unknown): ArtworkVerificationResult {
	return {
		ok: false,
		verification: 'unavailable',
		observedFingerprint: null,
		errorCode: 'artwork_verification_unavailable',
		error: error instanceof Error ? error.message : 'Artwork verification is unavailable.'
	};
}
