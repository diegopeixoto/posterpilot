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
 * Change detection compares the server's current modified time to the one we
 * *previously stored* — both are the media server's own clock, so the decision is
 * immune to clock skew between the server and the PosterPilot host (comparing a
 * server timestamp to our local `lastSyncedAt` would not be). `lastSyncedAt` is
 * used only as a "was this ever processed successfully?" watermark for retries:
 * when it's null (never synced, or a prior transient failure), we always reprocess.
 *
 * The bias is toward reprocessing whenever we can't be sure the item is unchanged.
 *
 * @param serverUpdatedAt The server's current last-modified time, or null when it
 *   reports none for this item.
 * @param previousServerUpdatedAt The server last-modified time we stored on the
 *   prior sync, or null when we have no baseline.
 * @param lastSyncedAt When this item was last *successfully* processed, or null.
 * @param opts Sync mode flags (full / incremental).
 * @returns `true` to run the expensive resolution + enrichment, `false` to skip.
 */
export function shouldReprocessItem(
	serverUpdatedAt: Date | null,
	previousServerUpdatedAt: Date | null,
	lastSyncedAt: Date | null,
	opts: ReprocessOptions
): boolean {
	// A full sync reprocesses everything regardless of timestamps.
	if (opts.full) return true;

	// Incremental disabled → behave like a full sync (always reprocess).
	if (!opts.incremental) return true;

	// Never successfully synced (new item, or a prior transient failure) → reprocess.
	if (lastSyncedAt === null) return true;

	// No current server timestamp → we can't tell whether it changed, so reprocess.
	if (serverUpdatedAt === null) return true;

	// No stored baseline to compare against → reprocess.
	if (previousServerUpdatedAt === null) return true;

	// Reprocess only when the server's modified time changed since we last stored it.
	return serverUpdatedAt.getTime() !== previousServerUpdatedAt.getTime();
}
