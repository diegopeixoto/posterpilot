/**
 * On-disk binary cache for provider preview images, fronted by a proxy route.
 *
 * Image bytes live on disk under `data/thumb-cache/<urlHash>`; the
 * `thumbnail_cache` table is the index that tracks size + access time so the
 * cache can be pruned by TTL (per-entry age) and a total-size LRU bound (oldest
 * `accessedAt` evicted first).
 *
 * The hashing/expiry/eviction helpers are kept pure (no db/fs) so they can be
 * unit-tested without a database or filesystem; everything below that line is
 * the impure read/write/evict orchestration.
 */

import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { eq, inArray } from 'drizzle-orm';
import { resolveDataPaths } from '$lib/server/data-paths';
import { db } from '$lib/server/db';
import { thumbnailCache } from '$lib/server/db/schema';
import {
	safeArtworkRequestTarget,
	sanitizeServerArtworkUrl
} from '$lib/server/media-server/artwork-url';

/** How long a cached thumbnail stays fresh before it is re-fetched (30 days). */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Total on-disk budget for the thumbnail cache before LRU eviction kicks in (512 MB). */
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

/** Per-response ceiling so an untrusted upstream cannot exhaust process memory. */
const DEFAULT_MAX_THUMB_BYTES = 20 * 1024 * 1024;

/**
 * Directory holding the cached image bytes (one file per `urlHash`), placed next to
 * the SQLite DB (derived from `DATABASE_URL`) so it lands on the same persistent
 * volume as the rest of the app state. Falls back to `./data/thumb-cache` for the
 * dev default. Reads `process.env` (not `$env`) so the pure-helper tests, which
 * import this module, stay free of `$env` resolution.
 */
function thumbCacheDir(): string {
	return resolveDataPaths(process.env.DATABASE_URL).thumbCacheDirectory;
}

// ── Pure helpers (no db / fs / $env) ───────────────────────────────────────────

/** Stable sha256 hex digest of a URL, used as the on-disk filename + index key. */
export function hashUrl(url: string): string {
	return createHash('sha256').update(url).digest('hex');
}

/** True when an entry fetched at `fetchedAt` is older than `ttlMs` as of `now`. */
export function isExpired(fetchedAt: Date, ttlMs: number, now: number): boolean {
	return now - fetchedAt.getTime() > ttlMs;
}

/**
 * Given the current cache entries, return the `urlHash`es to evict — oldest
 * `accessedAt` first — so the remaining total stays within `maxBytes`. Returns
 * an empty array when the cache is already under budget. Pure.
 */
export function selectEvictions(
	entries: { urlHash: string; sizeBytes: number; accessedAt: Date }[],
	maxBytes: number
): string[] {
	let total = entries.reduce((sum, e) => sum + e.sizeBytes, 0);
	if (total <= maxBytes) return [];

	const oldestFirst = [...entries].sort((a, b) => a.accessedAt.getTime() - b.accessedAt.getTime());
	const evict: string[] = [];
	for (const entry of oldestFirst) {
		if (total <= maxBytes) break;
		evict.push(entry.urlHash);
		total -= entry.sizeBytes;
	}
	return evict;
}

/**
 * Given the cache directory's file names and the set of indexed hashes, return
 * the file names that are cache entries (sha256-hex names) with no index row.
 * Anything that doesn't look like a cache file is left alone. Pure.
 */
export function selectOrphanedCacheFiles(
	fileNames: string[],
	indexedHashes: Set<string>
): string[] {
	return fileNames.filter((name) => /^[a-f0-9]{64}$/.test(name) && !indexedHashes.has(name));
}

// ── Impure orchestration (db + fs) ─────────────────────────────────────────────

/** Cached image bytes plus the MIME type to serve them with. */
export interface ThumbBytes {
	bytes: Buffer;
	contentType: string;
}

/** Read a fetch response incrementally and stop before it can exceed `maxBytes`. */
export async function readBoundedThumbBody(response: Response, maxBytes: number): Promise<Buffer> {
	if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
		throw new RangeError('Thumbnail response limit must be a positive integer');
	}
	const declaredLength = Number(response.headers.get('content-length'));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new Error('Thumbnail response exceeds the per-image size limit');
	}
	if (!response.body) return Buffer.alloc(0);

	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			if (!value) continue;
			total += value.byteLength;
			if (total > maxBytes) {
				await reader.cancel().catch(() => undefined);
				throw new Error('Thumbnail response exceeds the per-image size limit');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(
		chunks.map((chunk) => Buffer.from(chunk)),
		total
	);
}

/** Absolute-from-cwd path of the on-disk file for a given URL hash. */
function filePathFor(urlHash: string): string {
	return join(thumbCacheDir(), urlHash);
}

/**
 * Return a cached thumbnail for `url`, or null on a miss. A miss is: no index
 * row, an expired row (older than `ttlMs`), or a row whose backing file is gone
 * from disk (the stale row is deleted in that case). On a hit, `accessedAt` is
 * bumped for LRU.
 */
async function getCachedThumb(
	url: string,
	opts: { ttlMs?: number } = {}
): Promise<ThumbBytes | null> {
	const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
	const urlHash = hashUrl(url);

	const row = (
		await db.select().from(thumbnailCache).where(eq(thumbnailCache.urlHash, urlHash)).limit(1)
	)[0];
	if (!row) return null;
	if (isExpired(row.fetchedAt, ttlMs, Date.now())) return null;

	let bytes: Buffer;
	try {
		bytes = await readFile(filePathFor(urlHash));
	} catch {
		// Index row points at a file that no longer exists — drop the stale row and
		// report a miss so the caller re-fetches.
		await db.delete(thumbnailCache).where(eq(thumbnailCache.urlHash, urlHash));
		return null;
	}

	await db
		.update(thumbnailCache)
		.set({ accessedAt: new Date() })
		.where(eq(thumbnailCache.urlHash, urlHash));

	return { bytes, contentType: row.contentType };
}

/** Delete cache entries (rows + files) so the total on-disk size stays within `maxBytes`. */
async function evictToBudget(maxBytes: number): Promise<void> {
	const entries = await db
		.select({
			urlHash: thumbnailCache.urlHash,
			sizeBytes: thumbnailCache.sizeBytes,
			accessedAt: thumbnailCache.accessedAt
		})
		.from(thumbnailCache);

	const toEvict = selectEvictions(entries, maxBytes);
	if (toEvict.length === 0) return;

	await db.delete(thumbnailCache).where(inArray(thumbnailCache.urlHash, toEvict));
	await Promise.all(toEvict.map((urlHash) => rm(filePathFor(urlHash), { force: true })));
}

/**
 * Fetch `url`, write the bytes to disk, upsert the index row, then evict to keep
 * the cache within `maxBytes`. Throws if the upstream fetch fails (non-2xx or
 * network error) — the proxy route turns that into a 502.
 */
async function fetchAndCache(
	url: string,
	opts: { ttlMs?: number; maxBytes?: number; maxEntryBytes?: number } = {}
): Promise<ThumbBytes> {
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
	const maxEntryBytes = opts.maxEntryBytes ?? DEFAULT_MAX_THUMB_BYTES;
	const urlHash = hashUrl(url);

	// Refuse redirects so an allowlisted CDN host can't 30x us to an internal target
	// (SSRF), and time out so a hung upstream can't pin the request open.
	const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${safeArtworkRequestTarget(url)}`);
	const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
	const bytes = await readBoundedThumbBody(res, maxEntryBytes);

	await mkdir(thumbCacheDir(), { recursive: true });
	await writeFile(filePathFor(urlHash), bytes);

	const now = new Date();
	await db
		.insert(thumbnailCache)
		.values({
			urlHash,
			url: sanitizeServerArtworkUrl(url) ?? '[omitted]',
			contentType,
			sizeBytes: bytes.byteLength,
			fetchedAt: now,
			accessedAt: now
		})
		.onConflictDoUpdate({
			target: thumbnailCache.urlHash,
			set: {
				url: sanitizeServerArtworkUrl(url) ?? '[omitted]',
				contentType,
				sizeBytes: bytes.byteLength,
				fetchedAt: now,
				accessedAt: now
			}
		});

	await evictToBudget(maxBytes);

	return { bytes, contentType };
}

/**
 * Delete on-disk cache files that have no index row. Files and rows normally
 * live and die together, but migration 0008 wiped the index wholesale (cached
 * credential-bearing URLs must not survive the multi-server upgrade), which
 * orphaned every pre-upgrade file with no other reclamation path. Runs once at
 * boot, before any request or job can write new entries.
 */
export async function reconcileThumbCacheDisk(): Promise<number> {
	let names: string[];
	try {
		names = await readdir(thumbCacheDir());
	} catch {
		// Directory absent (fresh install / nothing cached yet) — nothing to do.
		return 0;
	}
	const rows = await db.select({ urlHash: thumbnailCache.urlHash }).from(thumbnailCache);
	const orphaned = selectOrphanedCacheFiles(names, new Set(rows.map((row) => row.urlHash)));
	await Promise.all(orphaned.map((name) => rm(filePathFor(name), { force: true })));
	return orphaned.length;
}

/** Serve `url` from the cache, fetching + caching it on a miss. */
export async function getOrFetchThumb(
	url: string,
	opts: { ttlMs?: number; maxBytes?: number; maxEntryBytes?: number } = {}
): Promise<ThumbBytes> {
	const cached = await getCachedThumb(url, opts);
	if (cached) return cached;
	return fetchAndCache(url, opts);
}
