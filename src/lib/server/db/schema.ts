import {
	sqliteTable,
	integer,
	real,
	text,
	index,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { TmdbCastMember } from '$lib/server/types';

/** A named Plex, Jellyfin, or Emby connection. Credentials are encrypted before storage. */
export const serverInstances = sqliteTable(
	'server_instances',
	{
		id: text('id').primaryKey(),
		name: text('name').notNull(),
		normalizedName: text('normalized_name').notNull(),
		type: text('type', { enum: ['plex', 'jellyfin', 'emby'] }).notNull(),
		baseUrl: text('base_url'),
		credential: text('credential'),
		connectionSettings: text('connection_settings', { mode: 'json' }).$type<
			Record<string, unknown>
		>(),
		capabilities: text('capabilities', { mode: 'json' }).$type<Record<string, unknown>>(),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		protected: integer('protected', { mode: 'boolean' }).notNull().default(false),
		connectionStatus: text('connection_status', {
			enum: ['unknown', 'healthy', 'unauthorized', 'unreachable', 'disabled']
		})
			.notNull()
			.default('unknown'),
		lastTestedAt: integer('last_tested_at', { mode: 'timestamp' }),
		disconnectedAt: integer('disconnected_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('server_instances_active_name_unique')
			.on(t.normalizedName)
			.where(sql`${t.enabled} = 1 and ${t.disconnectedAt} is null`),
		index('server_instances_enabled_idx').on(t.enabled)
	]
);

/** Frozen, expiring, single-use mutation plan shared by every preview/confirm flow. */
export const operationPlans = sqliteTable(
	'operation_plans',
	{
		id: text('id').primaryKey(),
		kind: text('kind').notNull(),
		serverInstanceId: text('server_instance_id').references(() => serverInstances.id),
		librarySectionKey: text('library_section_key'),
		/** Canonical JSON string; kept unparsed so the stored bytes reproduce `digest`. */
		payload: text('payload').notNull(),
		digest: text('digest').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		expiresAt: integer('expires_at', { mode: 'timestamp' }).notNull(),
		consumedAt: integer('consumed_at', { mode: 'timestamp' })
	},
	(t) => [
		index('operation_plans_scope_expiry_idx').on(t.kind, t.serverInstanceId, t.expiresAt),
		index('operation_plans_digest_idx').on(t.digest)
	]
);

/** A media-server library item (movie or show) and its resolved metadata. */
export const mediaItems = sqliteTable(
	'media_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		ratingKey: text('rating_key').notNull(),
		sectionKey: text('section_key').notNull(),
		type: text('type', { enum: ['movie', 'show'] }).notNull(),
		title: text('title').notNull(),
		year: integer('year'),
		tmdbId: text('tmdb_id'),
		imdbId: text('imdb_id'),
		tvdbId: text('tvdb_id'),
		/** Media type as classified against TMDB (movie/tv); null until resolved. */
		mediaType: text('media_type', { enum: ['movie', 'tv'] }),
		resolutionReason: text('resolution_reason'),
		manualMatchPinned: integer('manual_match_pinned', { mode: 'boolean' }).notNull().default(false),
		resolutionUpdatedAt: integer('resolution_updated_at', { mode: 'timestamp' }),
		currentPosterUrl: text('current_poster_url'),
		currentBackgroundUrl: text('current_background_url'),
		currentPosterFingerprint: text('current_poster_fingerprint'),
		currentBackgroundFingerprint: text('current_background_fingerprint'),
		artworkVersion: integer('artwork_version').notNull().default(0),
		/** User's pending cover selection (applied on the next apply action). */
		selectedPosterUrl: text('selected_poster_url'),
		selectedBackgroundUrl: text('selected_background_url'),
		selectedPosterCandidateId: integer('selected_poster_candidate_id'),
		selectedBackgroundCandidateId: integer('selected_background_candidate_id'),
		selectionUpdatedAt: integer('selection_updated_at', { mode: 'timestamp' }),
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
		tmdbCollectionId: text('tmdb_collection_id'),
		tmdbCollectionName: text('tmdb_collection_name'),
		hasCandidates: integer('has_candidates', { mode: 'boolean' }).notNull().default(false),
		hasMediux: integer('has_mediux', { mode: 'boolean' }).notNull().default(false),
		resolved: integer('resolved', { mode: 'boolean' }).notNull().default(false),
		/** User-marked "leave this alone": excluded from discover/apply/auto-select. */
		ignored: integer('ignored', { mode: 'boolean' }).notNull().default(false),
		reviewedAt: integer('reviewed_at', { mode: 'timestamp' }),
		discoveryStatus: text('discovery_status', {
			enum: ['not_started', 'running', 'succeeded', 'empty', 'partial', 'failed']
		})
			.notNull()
			.default('not_started'),
		discoveryStartedAt: integer('discovery_started_at', { mode: 'timestamp' }),
		discoveryCompletedAt: integer('discovery_completed_at', { mode: 'timestamp' }),
		externalArtworkChangedAt: integer('external_artwork_changed_at', { mode: 'timestamp' }),
		lastVerifiedAt: integer('last_verified_at', { mode: 'timestamp' }),
		/** The media server's own last-modified time for this item (null = unknown). */
		serverUpdatedAt: integer('server_updated_at', { mode: 'timestamp' }),
		/** When the item was added to the media server library (null = unknown). */
		addedAt: integer('added_at', { mode: 'timestamp' }),
		/** Played on the server: movie played at least once, show fully played. */
		watched: integer('watched', { mode: 'boolean' }).notNull().default(false),
		/** When this item was last processed by a sync (null = never). */
		lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
		sourceRemovedAt: integer('source_removed_at', { mode: 'timestamp' }),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('media_items_server_rating_key_unique').on(t.serverInstanceId, t.ratingKey),
		index('media_items_server_section_idx').on(t.serverInstanceId, t.sectionKey),
		index('media_items_server_review_idx').on(
			t.serverInstanceId,
			t.ignored,
			t.reviewedAt,
			t.discoveryStatus
		)
	]
);

/** A candidate artwork asset discovered by an enabled provider for a media item. */
export const posterCandidates = sqliteTable(
	'poster_candidates',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		discoveryRunId: text('discovery_run_id'),
		providerOutcomeId: integer('provider_outcome_id'),
		setId: text('set_id').notNull(),
		/** Which artwork provider produced this candidate (mediux, tmdb, fanarttv, theposterdb). */
		provider: text('provider').notNull().default('mediux'),
		providerAssetId: text('provider_asset_id'),
		/** Uploader/author of the set, when present in the payload. */
		setAuthor: text('set_author'),
		designFamily: text('design_family'),
		language: text('language'),
		url: text('url').notNull(),
		kind: text('kind', { enum: ['poster', 'background', 'season', 'title_card'] }).notNull(),
		season: integer('season'),
		episode: integer('episode'),
		resolvedTmdbId: text('resolved_tmdb_id'),
		resolvedMediaType: text('resolved_media_type', { enum: ['movie', 'tv'] }),
		/** Image dimensions when known, used for resolution scoring. */
		width: integer('width'),
		height: integer('height'),
		/** Computed selection score (provider weight + resolution + aspect fit); null until scored. */
		score: real('score'),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		stale: integer('stale', { mode: 'boolean' }).notNull().default(false),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index('poster_candidates_server_item_idx').on(t.serverInstanceId, t.mediaItemId),
		index('poster_candidates_provider_active_idx').on(
			t.serverInstanceId,
			t.mediaItemId,
			t.provider,
			t.active
		)
	]
);

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
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		kind: text('kind', { enum: ['poster', 'background', 'title_card'] }).notNull(),
		season: integer('season').notNull(),
		episode: integer('episode'),
		url: text('url').notNull(),
		candidateId: integer('candidate_id').references(() => posterCandidates.id, {
			onDelete: 'set null'
		}),
		provider: text('provider'),
		setId: text('set_id'),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	// SQLite treats NULLs as distinct in unique indexes, so season slots (episode NULL)
	// and episode slots (episode set) each need their own partial unique index.
	(t) => [
		uniqueIndex('child_selections_season_slot')
			.on(t.serverInstanceId, t.mediaItemId, t.kind, t.season)
			.where(sql`${t.episode} is null`),
		uniqueIndex('child_selections_episode_slot')
			.on(t.serverInstanceId, t.mediaItemId, t.kind, t.season, t.episode)
			.where(sql`${t.episode} is not null`)
	]
);

/** Legacy application history retained while new writes move to artwork revisions. */
export const appliedPosters = sqliteTable(
	'applied_posters',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		revisionGroupId: text('revision_group_id'),
		revisionId: text('revision_id'),
		candidateId: integer('candidate_id').references(() => posterCandidates.id, {
			onDelete: 'set null'
		}),
		url: text('url').notNull(),
		method: text('method', { enum: ['plex', 'server', 'kometa', 'both'] }).notNull(),
		destination: text('destination', { enum: ['server', 'kometa'] }),
		status: text('status', { enum: ['success', 'failed', 'partial', 'skipped'] }).notNull(),
		verification: text('verification', {
			enum: ['exact', 'best_effort', 'unavailable', 'mismatch', 'failed']
		}),
		sourceProvider: text('source_provider'),
		contentHash: text('content_hash'),
		errorCode: text('error_code'),
		error: text('error'),
		/** Slot granularity: null kind = show-level; otherwise the applied child slot. */
		kind: text('kind', { enum: ['poster', 'background', 'title_card'] }),
		season: integer('season'),
		episode: integer('episode'),
		appliedAt: integer('applied_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [index('applied_posters_server_item_idx').on(t.serverInstanceId, t.mediaItemId)]
);

/** Durable background work and its immutable execution inputs. */
export const jobs = sqliteTable(
	'jobs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id').references(() => serverInstances.id),
		librarySectionKey: text('library_section_key'),
		planId: text('plan_id').references(() => operationPlans.id, { onDelete: 'set null' }),
		parentJobId: integer('parent_job_id').references((): AnySQLiteColumn => jobs.id, {
			onDelete: 'set null'
		}),
		type: text('type', {
			enum: [
				'sync',
				'full_rescan',
				'discover',
				'apply',
				'undo',
				'retry',
				'automation',
				'diagnostics',
				'backup',
				'restore',
				'collection_apply',
				'cross_server_apply'
			]
		}).notNull(),
		status: text('status', {
			enum: [
				'pending',
				'running',
				'retry_scheduled',
				'completed',
				'partial_failed',
				'failed',
				'cancelled',
				'interrupted'
			]
		})
			.notNull()
			.default('pending'),
		phase: text('phase'),
		payload: text('payload', { mode: 'json' })
			.$type<Record<string, unknown>>()
			.notNull()
			.default(sql`'{}'`),
		result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
		initiator: text('initiator').notNull().default('user'),
		idempotencyKey: text('idempotency_key'),
		dedupeKey: text('dedupe_key'),
		attempt: integer('attempt').notNull().default(0),
		maxAttempts: integer('max_attempts').notNull().default(3),
		availableAt: integer('available_at', { mode: 'timestamp' }),
		leaseOwner: text('lease_owner'),
		leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
		processed: integer('processed').notNull().default(0),
		total: integer('total').notNull().default(0),
		currentItem: text('current_item'),
		errorCode: text('error_code'),
		error: text('error'),
		cancelRequestedAt: integer('cancel_requested_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: integer('started_at', { mode: 'timestamp' }),
		finishedAt: integer('finished_at', { mode: 'timestamp' }),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index('jobs_scope_status_idx').on(t.serverInstanceId, t.librarySectionKey, t.status),
		index('jobs_available_idx').on(t.status, t.availableAt),
		uniqueIndex('jobs_active_dedupe_unique')
			.on(t.dedupeKey)
			.where(
				sql`${t.dedupeKey} is not null and ${t.status} in ('pending', 'running', 'retry_scheduled')`
			),
		index('jobs_idempotency_idx').on(t.idempotencyKey)
	]
);

/** Append-only execution attempt history for a durable job. */
export const jobAttempts = sqliteTable(
	'job_attempts',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		jobId: integer('job_id')
			.notNull()
			.references(() => jobs.id, { onDelete: 'cascade' }),
		serverInstanceId: text('server_instance_id').references(() => serverInstances.id),
		attemptNumber: integer('attempt_number').notNull(),
		trigger: text('trigger').notNull(),
		status: text('status', {
			enum: [
				'pending',
				'running',
				'completed',
				'partial_failed',
				'failed',
				'interrupted',
				'cancelled'
			]
		}).notNull(),
		leaseOwner: text('lease_owner'),
		leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp' }),
		result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
		retryable: integer('retryable', { mode: 'boolean' }),
		errorCode: text('error_code'),
		error: text('error'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: integer('started_at', { mode: 'timestamp' }),
		finishedAt: integer('finished_at', { mode: 'timestamp' })
	},
	(t) => [
		uniqueIndex('job_attempts_job_number_unique').on(t.jobId, t.attemptNumber),
		index('job_attempts_server_idx').on(t.serverInstanceId, t.createdAt)
	]
);

/** Item/slot-level durable results, used to retry only eligible failed work. */
export const jobItemOutcomes = sqliteTable(
	'job_item_outcomes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		jobId: integer('job_id')
			.notNull()
			.references(() => jobs.id, { onDelete: 'cascade' }),
		attemptId: integer('attempt_id').references(() => jobAttempts.id, { onDelete: 'set null' }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id').references(() => mediaItems.id, {
			onDelete: 'set null'
		}),
		destination: text('destination'),
		kind: text('kind'),
		season: integer('season'),
		episode: integer('episode'),
		status: text('status', { enum: ['success', 'failed', 'skipped', 'interrupted'] }).notNull(),
		retryable: integer('retryable', { mode: 'boolean' }).notNull().default(false),
		result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
		errorCode: text('error_code'),
		error: text('error'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index('job_item_outcomes_retry_idx').on(t.jobId, t.status, t.retryable),
		index('job_item_outcomes_server_item_idx').on(t.serverInstanceId, t.mediaItemId)
	]
);

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
export const events = sqliteTable(
	'events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id').references(() => serverInstances.id),
		jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		mediaItemId: integer('media_item_id').references(() => mediaItems.id, {
			onDelete: 'set null'
		}),
		level: text('level', { enum: ['info', 'warn', 'error'] }).notNull(),
		/** Coarse category, e.g. 'sync' | 'discover' | 'apply' | 'provider' | 'system'. */
		type: text('type').notNull(),
		/** Locale-neutral event code and named parameters for rendering in the active locale. */
		code: text('code'),
		parameters: text('parameters', { mode: 'json' }).$type<Record<string, unknown>>(),
		correlationId: text('correlation_id'),
		/** Retained for compatibility with existing events; new consumers prefer code/parameters. */
		message: text('message').notNull(),
		/** Optional structured detail, serialized as JSON. */
		context: text('context'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index('events_server_created_idx').on(t.serverInstanceId, t.createdAt),
		index('events_job_idx').on(t.jobId)
	]
);

/** A native or TMDB-backed collection, qualified by source and server instance. */
export const mediaCollections = sqliteTable(
	'media_collections',
	{
		id: text('id').primaryKey(),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		source: text('source', { enum: ['tmdb', 'native'] }).notNull(),
		sourceId: text('source_id').notNull(),
		name: text('name').notNull(),
		nativeProvider: text('native_provider'),
		currentPosterUrl: text('current_poster_url'),
		currentBackgroundUrl: text('current_background_url'),
		capabilities: text('capabilities', { mode: 'json' }).$type<Record<string, unknown>>(),
		metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
		firstSeenAt: integer('first_seen_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		lastSyncedAt: integer('last_synced_at', { mode: 'timestamp' }),
		removedAt: integer('removed_at', { mode: 'timestamp' }),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('media_collections_server_source_unique').on(
			t.serverInstanceId,
			t.source,
			t.sourceId
		),
		index('media_collections_server_name_idx').on(t.serverInstanceId, t.name)
	]
);

/** Source-qualified membership, including unavailable TMDB members shown as context. */
export const collectionMemberships = sqliteTable(
	'collection_memberships',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		collectionId: text('collection_id')
			.notNull()
			.references(() => mediaCollections.id, { onDelete: 'cascade' }),
		mediaItemId: integer('media_item_id').references(() => mediaItems.id, {
			onDelete: 'set null'
		}),
		source: text('source', { enum: ['tmdb', 'native'] }).notNull(),
		sourceMemberId: text('source_member_id').notNull(),
		title: text('title'),
		year: integer('year'),
		availableLocally: integer('available_locally', { mode: 'boolean' }).notNull().default(true),
		provenance: text('provenance', { mode: 'json' }).$type<Record<string, unknown>>(),
		firstSeenAt: integer('first_seen_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		removedAt: integer('removed_at', { mode: 'timestamp' })
	},
	(t) => [
		uniqueIndex('collection_memberships_source_member_unique').on(
			t.serverInstanceId,
			t.collectionId,
			t.source,
			t.sourceMemberId
		),
		index('collection_memberships_item_idx').on(t.serverInstanceId, t.mediaItemId)
	]
);

/** Current observed identity and independent cache version for one artwork slot. */
export const artworkSlotStates = sqliteTable(
	'artwork_slot_states',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id').references(() => mediaItems.id, {
			onDelete: 'cascade'
		}),
		mediaCollectionId: text('media_collection_id').references(() => mediaCollections.id, {
			onDelete: 'cascade'
		}),
		kind: text('kind', { enum: ['poster', 'background', 'title_card'] }).notNull(),
		season: integer('season'),
		episode: integer('episode'),
		currentUrl: text('current_url'),
		currentFingerprint: text('current_fingerprint'),
		artworkVersion: integer('artwork_version').notNull().default(0),
		lastObservedAt: integer('last_observed_at', { mode: 'timestamp' }),
		lastVerifiedAt: integer('last_verified_at', { mode: 'timestamp' }),
		externalChangedAt: integer('external_changed_at', { mode: 'timestamp' }),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('artwork_slot_states_item_root_unique')
			.on(t.serverInstanceId, t.mediaItemId, t.kind)
			.where(
				sql`${t.mediaItemId} is not null and ${t.mediaCollectionId} is null and ${t.season} is null and ${t.episode} is null`
			),
		uniqueIndex('artwork_slot_states_item_season_unique')
			.on(t.serverInstanceId, t.mediaItemId, t.kind, t.season)
			.where(
				sql`${t.mediaItemId} is not null and ${t.mediaCollectionId} is null and ${t.season} is not null and ${t.episode} is null`
			),
		uniqueIndex('artwork_slot_states_item_episode_unique')
			.on(t.serverInstanceId, t.mediaItemId, t.kind, t.season, t.episode)
			.where(
				sql`${t.mediaItemId} is not null and ${t.mediaCollectionId} is null and ${t.episode} is not null`
			),
		uniqueIndex('artwork_slot_states_collection_unique')
			.on(t.serverInstanceId, t.mediaCollectionId, t.kind)
			.where(sql`${t.mediaItemId} is null and ${t.mediaCollectionId} is not null`)
	]
);

/** Immutable state captured before or after a server/Kometa artwork mutation. */
export const artworkSnapshots = sqliteTable(
	'artwork_snapshots',
	{
		id: text('id').primaryKey(),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id').references(() => mediaItems.id),
		mediaCollectionId: text('media_collection_id').references(() => mediaCollections.id),
		destination: text('destination', { enum: ['server', 'kometa'] }).notNull(),
		kind: text('kind', { enum: ['poster', 'background', 'title_card'] }).notNull(),
		season: integer('season'),
		episode: integer('episode'),
		state: text('state', { enum: ['present', 'absent', 'unavailable'] }).notNull(),
		sha256: text('sha256'),
		storagePath: text('storage_path'),
		contentType: text('content_type'),
		sizeBytes: integer('size_bytes'),
		value: text('value', { mode: 'json' }).$type<unknown>(),
		metadata: text('metadata', { mode: 'json' }).$type<Record<string, unknown>>(),
		isOriginal: integer('is_original', { mode: 'boolean' }).notNull().default(false),
		retainedUntil: integer('retained_until', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index('artwork_snapshots_sha_idx').on(t.sha256),
		index('artwork_snapshots_server_item_idx').on(t.serverInstanceId, t.mediaItemId),
		uniqueIndex('artwork_snapshots_original_item_root_unique')
			.on(t.serverInstanceId, t.mediaItemId, t.destination, t.kind)
			.where(
				sql`${t.isOriginal} = 1 and ${t.mediaItemId} is not null and ${t.mediaCollectionId} is null and ${t.season} is null and ${t.episode} is null`
			),
		uniqueIndex('artwork_snapshots_original_item_season_unique')
			.on(t.serverInstanceId, t.mediaItemId, t.destination, t.kind, t.season)
			.where(
				sql`${t.isOriginal} = 1 and ${t.mediaItemId} is not null and ${t.mediaCollectionId} is null and ${t.season} is not null and ${t.episode} is null`
			),
		uniqueIndex('artwork_snapshots_original_item_episode_unique')
			.on(t.serverInstanceId, t.mediaItemId, t.destination, t.kind, t.season, t.episode)
			.where(
				sql`${t.isOriginal} = 1 and ${t.mediaItemId} is not null and ${t.mediaCollectionId} is null and ${t.episode} is not null`
			),
		uniqueIndex('artwork_snapshots_original_collection_unique')
			.on(t.serverInstanceId, t.mediaCollectionId, t.destination, t.kind)
			.where(
				sql`${t.isOriginal} = 1 and ${t.mediaItemId} is null and ${t.mediaCollectionId} is not null`
			)
	]
);

/** One user/job operation grouping independent per-slot and per-destination revisions. */
export const artworkRevisionGroups = sqliteTable(
	'artwork_revision_groups',
	{
		id: text('id').primaryKey(),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		operationPlanId: text('operation_plan_id').references(() => operationPlans.id, {
			onDelete: 'set null'
		}),
		jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		kind: text('kind', { enum: ['apply', 'undo', 'external_observation'] }).notNull(),
		initiator: text('initiator').notNull(),
		outcome: text('outcome', { enum: ['pending', 'success', 'partial', 'failed'] })
			.notNull()
			.default('pending'),
		summary: text('summary', { mode: 'json' }).$type<Record<string, unknown>>(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		completedAt: integer('completed_at', { mode: 'timestamp' })
	},
	(t) => [index('artwork_revision_groups_server_created_idx').on(t.serverInstanceId, t.createdAt)]
);

/** Append-only outcome for exactly one destination and artwork slot. */
export const artworkRevisions = sqliteTable(
	'artwork_revisions',
	{
		id: text('id').primaryKey(),
		groupId: text('group_id')
			.notNull()
			.references(() => artworkRevisionGroups.id),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id').references(() => mediaItems.id),
		mediaCollectionId: text('media_collection_id').references(() => mediaCollections.id),
		operationPlanId: text('operation_plan_id').references(() => operationPlans.id, {
			onDelete: 'set null'
		}),
		jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		undoOfRevisionId: text('undo_of_revision_id').references(
			(): AnySQLiteColumn => artworkRevisions.id,
			{ onDelete: 'set null' }
		),
		beforeSnapshotId: text('before_snapshot_id').references(() => artworkSnapshots.id),
		afterSnapshotId: text('after_snapshot_id').references(() => artworkSnapshots.id),
		candidateId: integer('candidate_id').references(() => posterCandidates.id, {
			onDelete: 'set null'
		}),
		action: text('action', { enum: ['apply', 'undo', 'external_observation'] }).notNull(),
		destination: text('destination', { enum: ['server', 'kometa'] }).notNull(),
		kind: text('kind', { enum: ['poster', 'background', 'title_card'] }).notNull(),
		season: integer('season'),
		episode: integer('episode'),
		applyMethod: text('apply_method'),
		sourceProvider: text('source_provider'),
		provenance: text('provenance', { mode: 'json' }).$type<Record<string, unknown>>(),
		priorFingerprint: text('prior_fingerprint'),
		proposedFingerprint: text('proposed_fingerprint'),
		outcome: text('outcome', { enum: ['pending', 'success', 'failed', 'skipped'] })
			.notNull()
			.default('pending'),
		verification: text('verification', {
			enum: ['pending', 'exact', 'best_effort', 'unavailable', 'mismatch', 'failed']
		})
			.notNull()
			.default('pending'),
		errorCode: text('error_code'),
		error: text('error'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		completedAt: integer('completed_at', { mode: 'timestamp' })
	},
	(t) => [
		index('artwork_revisions_item_timeline_idx').on(t.serverInstanceId, t.mediaItemId, t.createdAt),
		index('artwork_revisions_group_idx').on(t.groupId),
		index('artwork_revisions_undo_idx').on(t.undoOfRevisionId)
	]
);

/** One aggregate candidate-discovery pass for an item and resolved identity. */
export const providerDiscoveryRuns = sqliteTable(
	'provider_discovery_runs',
	{
		id: text('id').primaryKey(),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		tmdbId: text('tmdb_id'),
		mediaType: text('media_type', { enum: ['movie', 'tv'] }),
		status: text('status', { enum: ['running', 'succeeded', 'partial', 'failed'] })
			.notNull()
			.default('running'),
		startedAt: integer('started_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		completedAt: integer('completed_at', { mode: 'timestamp' })
	},
	(t) => [
		index('provider_discovery_runs_item_idx').on(t.serverInstanceId, t.mediaItemId, t.startedAt)
	]
);

/** Terminal result for each provider considered by a discovery run. */
export const providerDiscoveryOutcomes = sqliteTable(
	'provider_discovery_outcomes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		runId: text('run_id')
			.notNull()
			.references(() => providerDiscoveryRuns.id, { onDelete: 'cascade' }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		provider: text('provider').notNull(),
		status: text('status', {
			enum: ['succeeded', 'empty', 'disabled', 'missing_credential', 'timed_out', 'failed']
		}).notNull(),
		candidateCount: integer('candidate_count').notNull().default(0),
		retainedStaleCandidates: integer('retained_stale_candidates', { mode: 'boolean' })
			.notNull()
			.default(false),
		latencyMs: integer('latency_ms'),
		errorCode: text('error_code'),
		error: text('error'),
		lastSuccessAt: integer('last_success_at', { mode: 'timestamp' }),
		startedAt: integer('started_at', { mode: 'timestamp' }),
		completedAt: integer('completed_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('provider_discovery_outcomes_run_provider_unique').on(t.runId, t.provider),
		index('provider_discovery_outcomes_item_idx').on(
			t.serverInstanceId,
			t.mediaItemId,
			t.completedAt
		)
	]
);

/** Latest sanitized health for a provider/component, optionally scoped to a server. */
export const providerStatuses = sqliteTable(
	'provider_status',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id').references(() => serverInstances.id),
		componentType: text('component_type', {
			enum: ['server', 'tmdb', 'artwork_provider', 'kometa', 'data_path', 'backup_path']
		}).notNull(),
		componentKey: text('component_key').notNull(),
		status: text('status', {
			enum: ['healthy', 'degraded', 'unavailable', 'disabled', 'unknown']
		})
			.notNull()
			.default('unknown'),
		credentialStatus: text('credential_status', {
			enum: ['not_applicable', 'valid', 'missing', 'rejected', 'unknown']
		})
			.notNull()
			.default('unknown'),
		latencyMs: integer('latency_ms'),
		lastAttemptAt: integer('last_attempt_at', { mode: 'timestamp' }),
		lastSuccessAt: integer('last_success_at', { mode: 'timestamp' }),
		lastErrorAt: integer('last_error_at', { mode: 'timestamp' }),
		errorCode: text('error_code'),
		error: text('error'),
		capabilities: text('capabilities', { mode: 'json' }).$type<Record<string, unknown>>(),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('provider_status_server_component_unique')
			.on(t.serverInstanceId, t.componentType, t.componentKey)
			.where(sql`${t.serverInstanceId} is not null`),
		uniqueIndex('provider_status_global_component_unique')
			.on(t.componentType, t.componentKey)
			.where(sql`${t.serverInstanceId} is null`)
	]
);

/** A bounded non-mutating diagnostic pass. */
export const diagnosticRuns = sqliteTable(
	'diagnostic_runs',
	{
		id: text('id').primaryKey(),
		serverInstanceId: text('server_instance_id').references(() => serverInstances.id),
		jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		status: text('status', { enum: ['running', 'completed', 'partial', 'failed'] })
			.notNull()
			.default('running'),
		initiator: text('initiator').notNull().default('user'),
		summary: text('summary', { mode: 'json' }).$type<Record<string, unknown>>(),
		startedAt: integer('started_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		completedAt: integer('completed_at', { mode: 'timestamp' })
	},
	(t) => [index('diagnostic_runs_server_started_idx').on(t.serverInstanceId, t.startedAt)]
);

/** Sanitized component result retained as bounded diagnostic history. */
export const diagnosticResults = sqliteTable(
	'diagnostic_results',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		runId: text('run_id')
			.notNull()
			.references(() => diagnosticRuns.id, { onDelete: 'cascade' }),
		serverInstanceId: text('server_instance_id').references(() => serverInstances.id),
		componentType: text('component_type').notNull(),
		componentKey: text('component_key').notNull(),
		status: text('status', {
			enum: ['healthy', 'degraded', 'unavailable', 'disabled', 'unknown']
		}).notNull(),
		credentialStatus: text('credential_status'),
		latencyMs: integer('latency_ms'),
		lastSuccessAt: integer('last_success_at', { mode: 'timestamp' }),
		capabilities: text('capabilities', { mode: 'json' }).$type<Record<string, unknown>>(),
		pathChecks: text('path_checks', { mode: 'json' }).$type<Record<string, unknown>>(),
		errorCode: text('error_code'),
		error: text('error'),
		checkedAt: integer('checked_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index('diagnostic_results_component_idx').on(t.componentType, t.componentKey, t.checkedAt)
	]
);

/** Named, normalized server-side review query. Review buckets themselves remain derived. */
export const reviewViews = sqliteTable(
	'review_views',
	{
		id: text('id').primaryKey(),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		name: text('name').notNull(),
		normalizedName: text('normalized_name').notNull(),
		librarySectionKey: text('library_section_key'),
		filters: text('filters', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
		sort: text('sort', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('review_views_server_name_unique').on(t.serverInstanceId, t.normalizedName),
		index('review_views_server_library_idx').on(t.serverInstanceId, t.librarySectionKey)
	]
);

/** Append-only review intent/history; actionable state is derived from current facts. */
export const reviewEvents = sqliteTable(
	'review_events',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		action: text('action', {
			enum: ['reviewed', 'ignored', 'unignored', 'accepted_current', 'staged', 'completed']
		}).notNull(),
		fromState: text('from_state'),
		toState: text('to_state'),
		context: text('context', { mode: 'json' }).$type<Record<string, unknown>>(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index('review_events_item_timeline_idx').on(t.serverInstanceId, t.mediaItemId, t.createdAt)
	]
);

/** Persistent review-first interval, calendar, or event automation. */
export const automationSchedules = sqliteTable(
	'automation_schedules',
	{
		id: text('id').primaryKey(),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		name: text('name').notNull(),
		normalizedName: text('normalized_name').notNull(),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
		triggerType: text('trigger_type', { enum: ['interval', 'daily', 'event'] }).notNull(),
		action: text('action', { enum: ['sync', 'sync_discover'] })
			.notNull()
			.default('sync_discover'),
		timezone: text('timezone').notNull(),
		intervalMinutes: integer('interval_minutes'),
		localTime: text('local_time'),
		eventType: text('event_type'),
		libraryScopes: text('library_scopes', { mode: 'json' }).$type<string[]>().notNull(),
		discoveryInputs: text('discovery_inputs', { mode: 'json' }).$type<Record<string, unknown>>(),
		reviewViewId: text('review_view_id').references(() => reviewViews.id, {
			onDelete: 'set null'
		}),
		retryPolicy: text('retry_policy', { mode: 'json' }).$type<Record<string, unknown>>(),
		failurePauseThreshold: integer('failure_pause_threshold').notNull().default(3),
		consecutiveFailures: integer('consecutive_failures').notNull().default(0),
		catchUpWindowMinutes: integer('catch_up_window_minutes').notNull().default(60),
		webhookTokenHash: text('webhook_token_hash'),
		lastRunAt: integer('last_run_at', { mode: 'timestamp' }),
		lastSuccessAt: integer('last_success_at', { mode: 'timestamp' }),
		nextRunAt: integer('next_run_at', { mode: 'timestamp' }),
		pausedAt: integer('paused_at', { mode: 'timestamp' }),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		updatedAt: integer('updated_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		uniqueIndex('automation_schedules_server_name_unique').on(t.serverInstanceId, t.normalizedName),
		index('automation_schedules_due_idx').on(t.enabled, t.nextRunAt)
	]
);

/** One idempotent logical schedule/event occurrence and its frozen job payload. */
export const automationOccurrences = sqliteTable(
	'automation_occurrences',
	{
		id: text('id').primaryKey(),
		scheduleId: text('schedule_id')
			.notNull()
			.references(() => automationSchedules.id, { onDelete: 'cascade' }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		logicalKey: text('logical_key').notNull(),
		triggerType: text('trigger_type').notNull(),
		eventIdentity: text('event_identity'),
		scheduledFor: integer('scheduled_for', { mode: 'timestamp' }).notNull(),
		jobId: integer('job_id').references(() => jobs.id, { onDelete: 'set null' }),
		status: text('status', {
			enum: ['pending', 'running', 'completed', 'partial_failed', 'failed', 'skipped']
		})
			.notNull()
			.default('pending'),
		payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
		result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
		errorCode: text('error_code'),
		error: text('error'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: integer('started_at', { mode: 'timestamp' }),
		completedAt: integer('completed_at', { mode: 'timestamp' })
	},
	(t) => [
		uniqueIndex('automation_occurrences_schedule_logical_unique').on(t.scheduleId, t.logicalKey),
		index('automation_occurrences_server_created_idx').on(t.serverInstanceId, t.createdAt)
	]
);

/** Application-managed secret-bearing backup bundle inventory. */
export const backupRecords = sqliteTable(
	'backup_records',
	{
		id: text('id').primaryKey(),
		trigger: text('trigger', { enum: ['manual', 'scheduled', 'pre_restore'] }).notNull(),
		status: text('status', { enum: ['creating', 'completed', 'failed', 'invalid', 'deleted'] })
			.notNull()
			.default('creating'),
		bundleName: text('bundle_name').notNull(),
		storagePath: text('storage_path').notNull(),
		manifest: text('manifest', { mode: 'json' }).$type<Record<string, unknown>>(),
		appVersion: text('app_version'),
		schemaVersion: text('schema_version'),
		keyMode: text('key_mode', { enum: ['generated', 'environment', 'none'] }),
		keyFingerprint: text('key_fingerprint'),
		sizeBytes: integer('size_bytes'),
		checksum: text('checksum'),
		protected: integer('protected', { mode: 'boolean' }).notNull().default(false),
		validationStatus: text('validation_status', {
			enum: ['unknown', 'valid', 'warning', 'invalid']
		})
			.notNull()
			.default('unknown'),
		errorCode: text('error_code'),
		error: text('error'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		completedAt: integer('completed_at', { mode: 'timestamp' }),
		validatedAt: integer('validated_at', { mode: 'timestamp' }),
		deletedAt: integer('deleted_at', { mode: 'timestamp' })
	},
	(t) => [
		uniqueIndex('backup_records_bundle_name_unique').on(t.bundleName),
		index('backup_records_created_idx').on(t.createdAt)
	]
);

/** Auditable preview/replace/rollback lifecycle for an application restore. */
export const restoreRecords = sqliteTable(
	'restore_records',
	{
		id: text('id').primaryKey(),
		backupId: text('backup_id')
			.notNull()
			.references(() => backupRecords.id),
		safetyBackupId: text('safety_backup_id').references(() => backupRecords.id),
		operationPlanId: text('operation_plan_id').references(() => operationPlans.id, {
			onDelete: 'set null'
		}),
		status: text('status', {
			enum: ['previewed', 'pending_restart', 'restoring', 'completed', 'rolled_back', 'failed']
		}).notNull(),
		previewChecksum: text('preview_checksum').notNull(),
		report: text('report', { mode: 'json' }).$type<Record<string, unknown>>(),
		errorCode: text('error_code'),
		error: text('error'),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date()),
		startedAt: integer('started_at', { mode: 'timestamp' }),
		completedAt: integer('completed_at', { mode: 'timestamp' })
	},
	(t) => [index('restore_records_created_idx').on(t.createdAt)]
);

/** Append-only automatic/manual TMDB resolution decision history. */
export const resolutionAudits = sqliteTable(
	'resolution_audits',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		serverInstanceId: text('server_instance_id')
			.notNull()
			.references(() => serverInstances.id),
		mediaItemId: integer('media_item_id')
			.notNull()
			.references(() => mediaItems.id, { onDelete: 'cascade' }),
		action: text('action', {
			enum: ['created', 'refreshed', 'pinned', 'replaced', 'cleared', 'unresolved']
		}).notNull(),
		previousTmdbId: text('previous_tmdb_id'),
		previousMediaType: text('previous_media_type', { enum: ['movie', 'tv'] }),
		resultingTmdbId: text('resulting_tmdb_id'),
		resultingMediaType: text('resulting_media_type', { enum: ['movie', 'tv'] }),
		reason: text('reason').notNull(),
		source: text('source'),
		userConfirmed: integer('user_confirmed', { mode: 'boolean' }).notNull().default(false),
		attemptedSources: text('attempted_sources', { mode: 'json' }).$type<string[]>(),
		details: text('details', { mode: 'json' }).$type<Record<string, unknown>>(),
		createdAt: integer('created_at', { mode: 'timestamp' })
			.notNull()
			.$defaultFn(() => new Date())
	},
	(t) => [
		index('resolution_audits_item_timeline_idx').on(t.serverInstanceId, t.mediaItemId, t.createdAt)
	]
);

export type ServerInstance = typeof serverInstances.$inferSelect;
export type NewServerInstance = typeof serverInstances.$inferInsert;
export type OperationPlan = typeof operationPlans.$inferSelect;
export type NewOperationPlan = typeof operationPlans.$inferInsert;
export type MediaItem = typeof mediaItems.$inferSelect;
export type NewMediaItem = typeof mediaItems.$inferInsert;
export type PosterCandidate = typeof posterCandidates.$inferSelect;
export type NewPosterCandidate = typeof posterCandidates.$inferInsert;
export type ChildSelection = typeof childSelections.$inferSelect;
export type NewChildSelection = typeof childSelections.$inferInsert;
export type AppliedPoster = typeof appliedPosters.$inferSelect;
export type NewAppliedPoster = typeof appliedPosters.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type JobAttempt = typeof jobAttempts.$inferSelect;
export type NewJobAttempt = typeof jobAttempts.$inferInsert;
export type JobItemOutcome = typeof jobItemOutcomes.$inferSelect;
export type NewJobItemOutcome = typeof jobItemOutcomes.$inferInsert;
export type ThumbnailCacheEntry = typeof thumbnailCache.$inferSelect;
export type NewThumbnailCacheEntry = typeof thumbnailCache.$inferInsert;
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;
export type MediaCollection = typeof mediaCollections.$inferSelect;
export type CollectionMembership = typeof collectionMemberships.$inferSelect;
export type ArtworkSlotState = typeof artworkSlotStates.$inferSelect;
export type ArtworkSnapshot = typeof artworkSnapshots.$inferSelect;
export type ArtworkRevisionGroup = typeof artworkRevisionGroups.$inferSelect;
export type ArtworkRevision = typeof artworkRevisions.$inferSelect;
export type ProviderDiscoveryRun = typeof providerDiscoveryRuns.$inferSelect;
export type ProviderDiscoveryOutcome = typeof providerDiscoveryOutcomes.$inferSelect;
export type ProviderStatus = typeof providerStatuses.$inferSelect;
export type DiagnosticRun = typeof diagnosticRuns.$inferSelect;
export type DiagnosticResult = typeof diagnosticResults.$inferSelect;
export type ReviewView = typeof reviewViews.$inferSelect;
export type ReviewEvent = typeof reviewEvents.$inferSelect;
export type AutomationSchedule = typeof automationSchedules.$inferSelect;
export type AutomationOccurrence = typeof automationOccurrences.$inferSelect;
export type BackupRecord = typeof backupRecords.$inferSelect;
export type RestoreRecord = typeof restoreRecords.$inferSelect;
export type ResolutionAudit = typeof resolutionAudits.$inferSelect;
