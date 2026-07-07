/**
 * Local-network address detection for the optional-auth `local` bypass mode.
 * Pure and `$env`-free. Fail-closed: anything not clearly a loopback / private /
 * link-local / ULA address is treated as non-local.
 */

/** True when `ip` is a loopback, private (RFC1918), link-local, or IPv6 ULA address. */
export function isLocalAddress(ip: string | null | undefined): boolean {
	if (!ip) return false;
	let addr = ip.trim().toLowerCase();
	if (addr === '') return false;
	// Unwrap IPv4-mapped IPv6 (e.g. ::ffff:192.168.0.1).
	if (addr.startsWith('::ffff:')) addr = addr.slice('::ffff:'.length);

	if (addr === '::1') return true; // IPv6 loopback
	if (addr.includes(':')) {
		// fc00::/7 (unique-local) or fe80::/10 (link-local).
		return /^f[cd][0-9a-f]{2}:/.test(addr) || /^fe[89ab][0-9a-f]:/.test(addr);
	}

	const octets = addr.split('.');
	if (octets.length !== 4) return false;
	const n = octets.map((o) => (o === '' ? NaN : Number(o)));
	if (n.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return false;
	const [a, b] = n;
	if (a === 127) return true; // 127.0.0.0/8 loopback
	if (a === 10) return true; // 10.0.0.0/8
	if (a === 192 && b === 168) return true; // 192.168.0.0/16
	if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
	if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
	return false;
}

export interface BypassInput {
	/** The socket / resolved client address. */
	clientAddress: string | null | undefined;
	/** Whether a trusted `ADDRESS_HEADER` is configured (proxy trust set up). */
	addressHeaderConfigured: boolean;
	/** Whether the request carried a forwarded-for header (`X-Forwarded-For` / `Forwarded`). */
	hasForwardedHeader: boolean;
}

/**
 * Decide whether a request qualifies for the `local` bypass. Fail-closed behind a
 * proxy: if no trusted address header is configured but the request carries a
 * forwarded-for header, treat it as non-local — the socket address would be the
 * proxy's (usually private) IP, so trusting it would make all traffic look local.
 */
export function decideLocalBypass(input: BypassInput): boolean {
	if (!input.addressHeaderConfigured && input.hasForwardedHeader) return false;
	return isLocalAddress(input.clientAddress);
}
