const SECRET_KEY = /(token|api.?key|auth|credential|signature|secret|password)/i;

/** Remove embedded credentials and secret-like query values from browser/job output. */
export function redactSensitiveArtworkUrl(value: string | null): string | null {
	if (!value) return value;
	try {
		const url = new URL(value);
		url.username = '';
		url.password = '';
		for (const key of [...url.searchParams.keys()]) {
			if (SECRET_KEY.test(key)) url.searchParams.set(key, '[redacted]');
		}
		return url.toString();
	} catch {
		return value.replace(
			/([?&][^=]*(?:token|api.?key|auth|credential|signature|secret|password)[^=]*=)[^&]*/gi,
			'$1[redacted]'
		);
	}
}

export function redactApplyErrorText(value: string): string {
	return value
		.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => redactSensitiveArtworkUrl(url) ?? '')
		.replace(
			/([?&][^=]*(?:token|api.?key|auth|credential|signature|secret|password)[^=]*=)[^&\s]*/gi,
			'$1[redacted]'
		);
}
