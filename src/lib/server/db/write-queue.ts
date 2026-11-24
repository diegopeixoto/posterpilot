/**
 * Serializes SQLite write transactions within this process.
 *
 * SQLite allows only one writer at a time, and a busy timeout alone did not reliably make
 * concurrent writers wait their turn in practice; they still threw `SQLITE_BUSY: database is
 * locked`. (Transactions run on dedicated connections — see db/dedicated-transactions.ts —
 * which removes one reason the timeout misbehaved, but this queue stays the primary guard
 * until that is shown to be enough on its own.) Provider discovery writes each
 * provider's outcome concurrently (see posters/service.ts) and events are logged from many call
 * sites throughout the app, so without this queue those writes collide constantly.
 *
 * This is a plain in-memory promise chain, not a lock: `fn` runs once every previously queued
 * write has settled (success or failure), then the queue moves on regardless of the outcome.
 */
let queue: Promise<unknown> = Promise.resolve();

export function serializeWrite<T>(fn: () => Promise<T>): Promise<T> {
	const result = queue.then(fn, fn);
	queue = result.then(
		() => undefined,
		() => undefined
	);
	return result;
}
