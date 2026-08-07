const TMDB_IMAGE_AUTHORITY = /^https:\/\/image\.tmdb\.org/i;
const TMDB_IMAGE_PATH = /^\/t\/p\/(original|[wh][1-9]\d*)\/([A-Za-z0-9._~-]+)$/;

/**
 * Upgrade one recognized TMDB image asset to its original-resolution URL.
 * Unrecognized input is intentionally returned byte-for-byte unchanged.
 */
export function canonicalizeTmdbArtworkUrl(value: string): string {
	const authority = TMDB_IMAGE_AUTHORITY.exec(value);
	if (!authority) return value;

	const path = value.slice(authority[0].length);
	const match = TMDB_IMAGE_PATH.exec(path);
	if (!match || match[0] !== path || match[2] === '.' || match[2] === '..') return value;

	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return value;
	}
	if (
		parsed.protocol !== 'https:' ||
		parsed.hostname !== 'image.tmdb.org' ||
		parsed.username !== '' ||
		parsed.password !== '' ||
		parsed.port !== '' ||
		parsed.search !== '' ||
		parsed.hash !== ''
	) {
		return value;
	}

	return `https://image.tmdb.org/t/p/original/${match[2]}`;
}

/** Canonicalize only when provenance identifies the built-in TMDB provider. */
export function canonicalizeProviderArtworkUrl(value: string, provider: string | null): string {
	return provider === 'tmdb' ? canonicalizeTmdbArtworkUrl(value) : value;
}

/** Compare one destination URL under an explicit provider's canonicalization rules. */
export function equivalentProviderArtworkUrls(
	left: string,
	right: string,
	provider: string | null
): boolean {
	return (
		canonicalizeProviderArtworkUrl(left, provider) ===
		canonicalizeProviderArtworkUrl(right, provider)
	);
}

/**
 * Decide whether a persisted selection can safely inherit one candidate's provenance.
 * Explicit custom selections never inherit a candidate, even when their URL is identical.
 * Legacy providerless TMDB selections may recover across preview/original URL variants;
 * providerless selections for every other provider require byte-identical URLs.
 */
export function storedArtworkMatchesCandidate(input: {
	storedUrl: string;
	storedProvider: string | null;
	candidateUrl: string;
	candidateProvider: string;
}): boolean {
	if (input.storedProvider === 'custom') return false;
	if (input.storedProvider !== null && input.storedProvider !== input.candidateProvider) {
		return false;
	}
	if (input.storedProvider === null && input.candidateProvider !== 'tmdb') {
		return input.storedUrl === input.candidateUrl;
	}
	return equivalentProviderArtworkUrls(
		input.storedUrl,
		input.candidateUrl,
		input.storedProvider ?? input.candidateProvider
	);
}
