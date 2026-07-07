/**
 * Parse an HTTP `Retry-After` header into a millisecond delay. Pure and
 * `$env`-free. Supports both forms from RFC 7231: delta-seconds (e.g. `120`) and
 * an HTTP-date (e.g. `Wed, 21 Oct 2015 07:28:00 GMT`). Returns `null` for a
 * missing/invalid value, `0` for a past date, and clamps to `maxMs` so a hostile
 * or absurd value cannot stall a request indefinitely.
 */

/** Default upper bound on an honored Retry-After delay (60s). */
export const DEFAULT_MAX_RETRY_AFTER_MS = 60_000;

export function parseRetryAfter(
	header: string | null | undefined,
	now: number,
	maxMs: number = DEFAULT_MAX_RETRY_AFTER_MS
): number | null {
	if (header == null) return null;
	const value = header.trim();
	if (value === '') return null;

	// delta-seconds form.
	if (/^\d+$/.test(value)) {
		const ms = Number(value) * 1000;
		return Math.min(Math.max(0, ms), maxMs);
	}

	// HTTP-date form. All three RFC-7231 date formats contain a space and a `:`
	// time; requiring them keeps `Date.parse` from leniently accepting garbage
	// like `-5` (which it would read as a year), which must fall back to backoff.
	if (!value.includes(' ') || !value.includes(':')) return null;
	const when = Date.parse(value);
	if (Number.isNaN(when)) return null;
	const delta = when - now;
	return Math.min(Math.max(0, delta), maxMs);
}
