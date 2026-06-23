import { sqliteTable, integer, real, text } from 'drizzle-orm/sqlite-core';
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
	createdAt: integer('created_at', { mode: 'timestamp' })
		.notNull()
		.$defaultFn(() => new Date())
});

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

/** Persisted key/value settings (overridden by environment variables at runtime). */
export const settings = sqliteTable('settings', {
	key: text('key').primaryKey(),
	value: text('value').notNull()
});

export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type PosterCandidate = typeof posterCandidates.$inferSelect;
export type NewPosterCandidate = typeof posterCandidates.$inferInsert;
export type AppliedPoster = typeof appliedPosters.$inferSelect;
export type Job = typeof jobs.$inferSelect;
