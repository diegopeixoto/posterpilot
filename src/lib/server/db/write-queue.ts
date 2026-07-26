/**
 * Serializes SQLite write transactions within this process.
 *
 * SQLite allows only one writer at a time, and this app's local libsql client discards its
 * native connection after every `transaction()` call and lazily opens a new one — so a
 * `PRAGMA busy_timeout` (or the client's `timeout` config option, which is supposed to survive
 * that reconnect) does not reliably make concurrent writers wait their turn in practice; they
 * still throw `SQLITE_BUSY: database is locked` instead. Provider discovery writes each
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
