/**
 * In-memory per-client login throttle. Pure over an injected clock (`now` in ms)
 * so it is unit-testable; holds no persistent state, so a restart clears it. Slows
 * brute-force guessing: after `MAX_FAILURES` failures within `WINDOW_MS`, the
 * client is locked until the window rolls over. Callers additionally apply
 * `FAILURE_DELAY_MS` on each failed attempt.
 */

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
/** Fixed delay (ms) callers apply on each failed attempt to slow automation. */
export const FAILURE_DELAY_MS = 300;

interface Entry {
	failures: number;
	/** When the current window expires (ms). */
	resetAt: number;
}

export class LoginThrottle {
	private readonly entries = new Map<string, Entry>();

	/** True when the client is currently locked out. */
	isLocked(key: string, now: number): boolean {
		const e = this.entries.get(key);
		if (!e) return false;
		if (now >= e.resetAt) {
			this.entries.delete(key);
			return false;
		}
		return e.failures >= MAX_FAILURES;
	}

	/** Record a failed attempt; returns true if the client is now locked out. */
	recordFailure(key: string, now: number): boolean {
		let e = this.entries.get(key);
		if (!e || now >= e.resetAt) {
			e = { failures: 0, resetAt: now + WINDOW_MS };
			this.entries.set(key, e);
		}
		e.failures += 1;
		return e.failures >= MAX_FAILURES;
	}

	/** Clear a client's failures (e.g. after a successful login). */
	reset(key: string): void {
		this.entries.delete(key);
	}
}
