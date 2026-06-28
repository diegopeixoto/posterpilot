/**
 * Pure decision logic for incremental library sync.
 *
 * Sync's expensive per-item work (TMDB resolution + metadata enrichment) is
 * skippable when an item hasn't changed on the media server since we last
 * processed it. This module isolates the "should we reprocess this item?"
 * decision as a pure, `$env`-free function so it can be unit-tested without any
 * database or network I/O — the actual upsert/skip orchestration lives in
 * `tasks.ts`.
 */

/** Inputs that gate whether an item's expensive sync work runs. */
export interface ReprocessOptions {
	/** A full sync was requested: always reprocess, ignoring timestamps. */
	full: boolean;
	/** Incremental sync is enabled; when false, every item is reprocessed. */
	incremental: boolean;
}

/**
 * Decide whether a media item's expensive sync work should run this pass.
 *
 * The bias is toward reprocessing whenever we can't be sure the item is
 * unchanged — skipping is only safe when we have a server timestamp, a prior
 * sync timestamp, and the server's copy is no newer than what we last saw.
 *
 * @param serverUpdatedAt The media server's own last-modified time, or null
 *   when the server doesn't report one for this item.
 * @param lastSyncedAt When this item was last processed by a sync, or null
 *   when it has never been synced.
 * @param opts Sync mode flags (full / incremental).
 * @returns `true` to run the expensive resolution + enrichment, `false` to skip.
 */
export function shouldReprocessItem(
	serverUpdatedAt: Date | null,
	lastSyncedAt: Date | null,
	opts: ReprocessOptions
): boolean {
	// A full sync reprocesses everything regardless of timestamps.
	if (opts.full) return true;

	// Incremental disabled → behave like a full sync (always reprocess).
	if (!opts.incremental) return true;

	// No server timestamp → we can't tell whether it changed, so reprocess.
	if (serverUpdatedAt === null) return true;

	// Never synced before → there's nothing to compare against, so reprocess.
	if (lastSyncedAt === null) return true;

	// Otherwise reprocess only when the server's copy is strictly newer than
	// the last time we processed it.
	return serverUpdatedAt.getTime() > lastSyncedAt.getTime();
}
