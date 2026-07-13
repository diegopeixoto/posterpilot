const USER_INFO = /(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi;
const AUTHORIZATION = /\b((?:Bearer|Basic)\s+)[A-Za-z0-9._~+/=-]{4,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const AWS_ACCESS_KEY = /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g;
const QUERY_PAIR = /([?&])([^=&#\s"'<>]+)=([^&#\s"'<>]*)/g;
const LABELED_SECRET =
	/\b((?:x[-_ ]?plex[-_ ]?token|x[-_ ]?amz[-_ ]?(?:credential|signature)|access[-_ ]?token|api[-_ ]?key|apikey|authorization|password|passwd|secret|token|credential|signature|session|cookie|auth)\s*[:=]\s*)(?!<redacted>|\[redacted\])[^&#\s,;"']+/gi;

function decodeKey(value: string): string {
	let decoded = value.replace(/\+/g, ' ');
	for (let attempt = 0; attempt < 3 && /%[0-9a-f]{2}/i.test(decoded); attempt += 1) {
		try {
			const next = decodeURIComponent(decoded);
			if (next === decoded) break;
			decoded = next;
		} catch {
			break;
		}
	}
	return decoded.trim().toLowerCase();
}

/** Recognize credential-shaped object and query keys, including percent-encoded keys. */
export function isSecretLikeKey(value: string): boolean {
	const decoded = decodeKey(value);
	if (!decoded) return false;
	const segments = decoded.split(/[^a-z0-9]+/).filter(Boolean);
	if (
		segments.some((segment) =>
			[
				'token',
				'secret',
				'password',
				'passwd',
				'authorization',
				'credential',
				'signature'
			].includes(segment)
		)
	) {
		return true;
	}
	const compact = decoded.replace(/[^a-z0-9]/g, '');
	return (
		/^(?:apikey|auth|cookie|session|xplextoken|xamzcredential|xamzsignature|awsaccesskeyid)$/.test(
			compact
		) || /(?:token|secret|password|passwd|credential|signature)$/.test(compact)
	);
}

function knownSecretVariants(secrets: readonly string[]): string[] {
	const variants = new Set<string>();
	for (const secret of secrets) {
		if (!secret) continue;
		variants.add(secret);
		variants.add(encodeURIComponent(secret));
		variants.add(new URLSearchParams({ value: secret }).toString().slice('value='.length));
	}
	return [...variants].filter(Boolean).sort((a, b) => b.length - a.length);
}

/** Redact credentials consistently while allowing each public surface to retain its marker. */
export function redactSensitiveText(
	value: string,
	marker: string,
	secrets: readonly string[] = []
): string {
	let result = value;
	for (const secret of knownSecretVariants(secrets)) {
		result = result.split(secret).join(marker);
	}
	result = result.replace(USER_INFO, `$1${marker}@`);
	result = result.replace(QUERY_PAIR, (match, prefix: string, key: string, queryValue: string) =>
		queryValue && isSecretLikeKey(key) ? `${prefix}${key}=${marker}` : match
	);
	return result
		.replace(AUTHORIZATION, `$1${marker}`)
		.replace(JWT, marker)
		.replace(AWS_ACCESS_KEY, marker)
		.replace(LABELED_SECRET, `$1${marker}`);
}

/** Conservative post-redaction check used by fail-closed exports. */
export function containsSensitiveText(value: string, secrets: readonly string[] = []): boolean {
	if (knownSecretVariants(secrets).some((secret) => value.includes(secret))) return true;
	if (
		/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{4,}/i.test(value) ||
		/https?:\/\/[^/@\s:]+:[^/@\s]+@/i.test(value) ||
		/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/.test(value) ||
		/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(value) ||
		LABELED_SECRET.test(value)
	) {
		LABELED_SECRET.lastIndex = 0;
		return true;
	}
	LABELED_SECRET.lastIndex = 0;
	for (const match of value.matchAll(QUERY_PAIR)) {
		if (match[3] && isSecretLikeKey(match[2])) return true;
	}
	return false;
}
