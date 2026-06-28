import { sqliteTable, integer, real, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { TmdbCastMember } from '$lib/server/types';

/** A Plex library item (movie or show) and its resolved metadata. */
export const mediaItems = sqliteTable('media_items', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ratingKey: text('rating_key').notNull().unique(),
	sectionKey: text('section_key').notNull(),
	type: text('type', { enum: ['movie', 'show'] }).notNull(),
	title: text('title').notNull(),
	year: integer('year'),
	tmdbId: text('tmdb_id'),
	imdbId: text('imdb_id'),
	tvdbId: text('tvdb_id'),
	/** Media type as classified against TMDB (movie/tv); null until resolved. */
	mediaType: text('media_type', { enum: ['movie', 'tv'] }),
	currentPosterUrl: text('current_poster_url'),
	/** User's pending cover selection (applied on the next apply action). */
	selectedPosterUrl: text('selected_poster_url'),
	selectedBackgroundUrl: text('selected_background_url'),
	/** TMDB display metadata, populated during sync; null until enriched. */
	overview: text('overview'),
	tagline: text('tagline'),
	genres: text('genres', { mode: 'json' }).$type<string[]>(),
	runtime: integer('runtime'),
	rating: real('rating'),
	backdropUrl: text('backdrop_url'),
	logoUrl: text('logo_url'),
	seasonCount: integer('season_count'),
	episodeCount: integer('episode_count'),
	cast: text('cast', { mode: 'json' }).$type<TmdbCastMember[]>(),
	hasMediux: integer('has_mediux', { mode: 'boolean' }),
	resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
	/** User-marked "leave this alone": excluded from discover/apply/auto-select. */
	ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
	/** The media server's own last-modified time for this item (null = unknown). */
	serverUpdatedAt: integer('server_updated_at', { mode: 'timestamp' }),
	/** When this item was last processed by a sync (null = never). */
	lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
	updatedAt: integer('updated_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/** A candidate artwork asset discovered on mediux.pro for a media item. */
export const posterCandidates = sqliteTable('poster_candidates', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	mediaItemId: integer('media_item_id')
		.notNull()
		.references(() => mediaItems.id, { onDelete: 'cascade' }),
	setId: text('set_id').notNull(),
	/** Which artwork provider produced this candidate (mediux, tmdb, fanarttv, theposterdb). */
	provider: text('provider').notNull().default('mediux'),
	/** Uploader/author of the set, when present in the payload. */
	setAuthor: text('set_author'),
	url: text('url').notNull(),
	kind: text('kind', { enum: ['poster', 'background', 'season', 'title_card'] }).notNull(),
	season: integer('season'),
	episode: integer('episode'),
	/** Image dimensions when known, used for resolution scoring. */
	width: integer('width'),
	height: integer('height'),
	/** Computed selection score (provider weight + resolution + aspect fit); null until scored. */
	score: real('score'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * User's pending selection for a single season/episode artwork slot, kept separate
 * from the show-level poster/background on `media_items`. Season slots use
 * `kind` poster|background with `episode` NULL; episode slots use `kind` title_card
 * with `episode` set. Uniqueness is enforced per-slot (see partial indexes below).
 */
export const childSelections = sqliteTable(
	'child_selections',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		mediaItemId: integer('media_item_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['poster', 'background', 'title_card'] }).notNull(),
		season: integer('season').notNull(),
		episode: integer('episode'),
		url: text('url').notNull(),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	// SQLite treats NULLs as distinct in unique indexes, so season slots (episode NULL)
	// and episode slots (episode set) each need their own partial unique index.
	(t) => [
		uniqueIndex('child_selections_season_slot')
			.on(t.mediaItemId, t.kind, t.season)
			.where(sql`${t.episode} is null`),
		uniqueIndex('child_selections_episode_slot')
			.on(t.mediaItemId, t.kind, t.season, t.episode)
			.where(sql`${t.episode} is not null`)
	]
);

/** History of cover applications (Plex upload and/or Kometa export). */
export const appliedPosters = sqliteTable('applied_posters', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	mediaItemId: integer('media_item_id')
		.notNull()
		.references(() => mediaItems.id, { onDelete: 'cascade' }),
	url: text('url').notNull(),
	method: text('method', { enum: ['plex', 'kometa'] }).notNull(),
	status: text('status', { enum: ['success', 'failed'] }).notNull(),
	error: text('error'),
	/** Slot granularity: null kind = show-level; otherwise the applied child slot. */
	kind: text('kind', { enum: ['poster', 'background', 'title_card'] }),
	season: integer('season'),
	episode: integer('episode'),
	appliedAt: integer('applied_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/** Background job records (library sync, bulk discovery, bulk apply). */
export const jobs = sqliteTable('jobs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	type: text('type', { enum: ['sync', 'discover', 'apply'] }).notNull(),
	status: text('status', {
		enum: ['pending', 'running', 'completed', 'failed', 'cancelled', 'interrupted']
	})
		.notNull()
		.default('pending'),
	processed: integer('processed').notNull().default(0),
	total: integer('total').notNull().default(0),
	currentItem: text('current_item'),
	error: text('error'),
	startedAt: integer('started_at', { mode: 'timestamp' }),
	finishedAt: integer('finished_at', { mode: 'timestamp' })
});

/** Cached HTTP responses (TMDB + MediaUX) keyed by URL. */
export const httpCache = sqliteTable('http_cache', {
	url: text('url').primaryKey(),
	body: text('body').notNull(),
	fetchedAt: integer('fetched_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/**
 * Index for the on-disk binary thumbnail cache. The image bytes live on disk at
 * `data/thumb-cache/<urlHash>`; this row tracks size + access time for TTL/LRU pruning.
 */
export const thumbnailCache = sqliteTable('thumbnail_cache', {
	urlHash: text('url_hash').primaryKey(),
	url: text('url').notNull(),
	contentType: text('content_type').notNull(),
	sizeBytes: integer('size_bytes').notNull(),
	fetchedAt: integer('fetched_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date()),
	/** Last served time, bumped on cache hit for LRU eviction. */
	accessedAt: integer('accessed_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

/** Persisted key/value settings (overridden by environment variables at runtime). */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

/** Operational activity log (job lifecycle, failures, notable system events). */
export const events = sqliteTable('events', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	level: text('level', { enum: ['info', 'warn', 'error'] }).notNull(),
	/** Coarse category, e.g. 'sync' | 'discover' | 'apply' | 'provider' | 'system'. */
	type: text('type').notNull(),
	message: text('message').notNull(),
	/** Optional structured detail, serialized as JSON. */
	context: text('context'),
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type PosterCandidate = typeof posterCandidates.$inferSelect;
export type NewPosterCandidate = typeof posterCandidates.$inferInsert;
export type ChildSelection = typeof childSelections.$inferSelect;
export type NewChildSelection = typeof childSelections.$inferInsert;
export type AppliedPoster = typeof appliedPosters.$inferSelect;
export type ThumbnailCacheEntry = typeof thumbnailCache.$inferSelect;
export type NewThumbnailCacheEntry = typeof thumbnailCache.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
