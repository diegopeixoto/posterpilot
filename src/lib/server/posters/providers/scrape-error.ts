/** A scrape failure with a stable, provider-specific discovery outcome code. */
export class ProviderScrapeError extends Error {
	constructor(
		readonly code:
			| 'mediux_blocked'
			| 'mediux_payload_unreadable'
			| 'theposterdb_blocked'
			| 'theposterdb_auth_failed'
			| 'theposterdb_placeholder_only',
		message: string
	) {
		super(message);
		this.name = 'ProviderScrapeError';
	}
}

/** Explicit Cloudflare challenge markup, not ordinary page content mentioning Cloudflare. */
export function isCloudflareChallenge(html: string): boolean {
	const visible = html.replace(/<!--[\s\S]*?-->/g, '');
	return (
		/<form\b[^>]*\bid\s*=\s*["']challenge-form["'][^>]*>/i.test(visible) &&
		/\/cdn-cgi\/challenge-platform\//i.test(visible)
	);
}
