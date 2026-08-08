import { and, asc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { serializeWrite } from '$lib/server/db/write-queue';
import { artworkCoverage, mediaItems } from '$lib/server/db/schema';
import {
	COVERAGE_STATUSES,
	canonicalIdentityKey,
	isStatusValidForDestination,
	type CoverageDestination,
	type CoverageStatus
} from '$lib/artwork-coverage';

/** The artwork slots coverage is tracked for, matching `artwork_revisions.kind`. */
export type CoverageSlotKind = 'poster' | 'background' | 'title_card';

/**
 * One slot at one destination for one occurrence, plus the evidence that explains it.
 *
 * The reconcilers decide `status`; this store only persists it. Everything the store
 * derives itself — the occurrence's library and canonical identity — is deliberately absent
 * from this shape so a caller cannot file a title's coverage under the wrong library.
 */
export interface CoverageObservation {
	serverInstanceId: string;
	mediaItemId: number;
	destination: CoverageDestination;
	kind: CoverageSlotKind;
	/** Null for a root (show/movie-level) slot. Season 0 is specials, not "no season". */
	season?: number | null;
	/** Null for a root or season slot. */
	episode?: number | null;
	status: CoverageStatus;
	/** Locale-neutral code naming what was observed, e.g. `kometa_parse_failure`. */
	evidenceSource: string;
	evidenceRevisionId?: string | null;
	evidenceFingerprint?: string | null;
	/** Bounded structured context. Never secrets or full signed provider URLs. */
	evidenceDetail?: Record<string, unknown> | null;
	/** When the evidence was observed. Defaults to now; a replay should pass the real time. */
	observedAt?: Date;
}

/**
 * The slice of the projection a rebuild replaces or a caller drops.
 *
 * `serverInstanceId` is mandatory: every read and every rebuild is server-scoped, and a
 * scopeless delete would let one server's reconciliation pass erase another's evidence.
 */
export interface CoverageScope {
	serverInstanceId: string;
	destination?: CoverageDestination;
	librarySectionKey?: string;
	mediaItemIds?: number[];
}

export type CoverageStoreErrorCode =
	| 'invalid_status_for_destination'
	| 'invalid_slot'
	| 'invalid_evidence'
	| 'unknown_occurrence'
	| 'scope_mismatch';

/** A safe, locale-neutral coverage-store failure suitable for route adapters to map. */
export class CoverageStoreError extends Error {
	constructor(
		readonly code: CoverageStoreErrorCode,
		message: string
	) {
		super(message);
		this.name = 'CoverageStoreError';
	}
}

export interface CoverageStatusCounts {
	/** Zero-filled for every status the requested destination can hold. */
	byStatus: Record<string, number>;
	total: number;
}

export interface ListStaleCoverageOptions {
	serverInstanceId: string;
	/** Rows observed strictly before this instant are candidates for re-reconciliation. */
	observedBefore: Date;
	limit?: number;
}

export interface CoverageStoreOptions {
	clock?: () => Date;
	/**
	 * Rows per insert statement during a rebuild. SQLite caps bound parameters per
	 * statement, and a projection rebuild is the one path that writes tens of thousands of
	 * rows at once.
	 */
	insertChunkSize?: number;
}

type CoverageDatabase = typeof db;
/** One persisted observation. Re-exported so callers never reach for the table type. */
export type CoverageRow = typeof artworkCoverage.$inferSelect;
type NewCoverageRow = typeof artworkCoverage.$inferInsert;

/** The occurrence provenance the store stamps onto a row; never caller-supplied. */
interface Occurrence {
	serverInstanceId: string;
	librarySectionKey: string;
	canonicalKey: string | null;
}

const DEFAULT_INSERT_CHUNK_SIZE = 200;

/**
 * The statuses that count as coverage at a destination, derived from the shared contract
 * so a SQL-level filter in the query layer cannot drift from `isCovered`.
 */
export function coveredStatusesFor(destination: CoverageDestination): CoverageStatus[] {
	return COVERAGE_STATUSES.filter(
		(status) =>
			isStatusValidForDestination(destination, status) &&
			(status === 'applied_on_server' || status === 'exported_to_kometa')
	);
}

/** Every status a destination may hold, for zero-filling counts and validating input. */
export function statusesFor(destination: CoverageDestination): CoverageStatus[] {
	return COVERAGE_STATUSES.filter((status) => isStatusValidForDestination(destination, status));
}

/**
 * NULL-aware equality for one slot. SQLite's `=` never matches NULL, so a root slot has to
 * be addressed with `is null` — the same reason the table needs three partial unique
 * indexes instead of one.
 */
export function coverageSlotCondition(slot: {
	kind: CoverageSlotKind;
	season?: number | null;
	episode?: number | null;
}) {
	const season = slot.season ?? null;
	const episode = slot.episode ?? null;
	return and(
		eq(artworkCoverage.kind, slot.kind),
		season === null ? isNull(artworkCoverage.season) : eq(artworkCoverage.season, season),
		episode === null ? isNull(artworkCoverage.episode) : eq(artworkCoverage.episode, episode)
	);
}

function assertInteger(value: unknown, label: string, code: CoverageStoreErrorCode): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
		throw new CoverageStoreError(code, `${label} must be a safe integer`);
	}
	return value;
}

function normalizeObservation(observation: CoverageObservation): CoverageObservation {
	if (!isStatusValidForDestination(observation.destination, observation.status)) {
		// The one invariant the UI's honesty rests on: a Kometa YAML entry is not artwork on a
		// server, and a server write is not a metadata export. Rejected here so a caller gets a
		// typed error rather than a raw constraint failure — the table CHECK is the backstop.
		throw new CoverageStoreError(
			'invalid_status_for_destination',
			`Status ${observation.status} cannot be recorded for destination ${observation.destination}`
		);
	}
	assertInteger(observation.mediaItemId, 'mediaItemId', 'unknown_occurrence');
	if (!observation.serverInstanceId) {
		throw new CoverageStoreError('unknown_occurrence', 'serverInstanceId is required');
	}

	const season = observation.season ?? null;
	const episode = observation.episode ?? null;
	if (season !== null) assertInteger(season, 'season', 'invalid_slot');
	if (episode !== null) {
		assertInteger(episode, 'episode', 'invalid_slot');
		// An episode slot with no season would land in the episode unique index against a NULL
		// season, and NULLs are distinct there — the slot would silently accept duplicates.
		if (season === null) {
			throw new CoverageStoreError('invalid_slot', 'An episode slot requires a season');
		}
	}
	if (!observation.evidenceSource?.trim()) {
		throw new CoverageStoreError(
			'invalid_evidence',
			'evidenceSource is required: a status nobody can explain is worse than no row'
		);
	}

	return { ...observation, season, episode };
}

/**
 * Whether a prepared row falls inside the scope a rebuild is about to clear.
 *
 * Checked against the *prepared* row, not the caller's observation, because
 * `library_section_key` is derived here — a caller rebuilding one library has no way to know
 * that an item it named has since moved to another, and writing that row would leave the
 * rebuild's own delete unable to reach it next time.
 */
function inScope(row: NewCoverageRow, scope: CoverageScope): boolean {
	if (row.serverInstanceId !== scope.serverInstanceId) return false;
	if (scope.destination && row.destination !== scope.destination) return false;
	if (scope.librarySectionKey && row.librarySectionKey !== scope.librarySectionKey) return false;
	if (scope.mediaItemIds && !scope.mediaItemIds.includes(row.mediaItemId)) return false;
	return true;
}

function scopeCondition(scope: CoverageScope) {
	const conditions = [eq(artworkCoverage.serverInstanceId, scope.serverInstanceId)];
	if (scope.destination) conditions.push(eq(artworkCoverage.destination, scope.destination));
	if (scope.librarySectionKey) {
		conditions.push(eq(artworkCoverage.librarySectionKey, scope.librarySectionKey));
	}
	if (scope.mediaItemIds) {
		conditions.push(inArray(artworkCoverage.mediaItemId, scope.mediaItemIds));
	}
	return and(...conditions);
}

function chunk<T>(values: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

/**
 * Build a coverage store over a Drizzle database.
 *
 * The store owns writing and rebuilding, not deciding: it never inspects a server, parses a
 * Kometa file, or infers a status. It validates the write boundary, stamps each row with the
 * occurrence's provenance, and keeps the projection replaceable.
 */
export function createCoverageStore(
	database: CoverageDatabase,
	options: CoverageStoreOptions = {}
) {
	const clock = options.clock ?? (() => new Date());
	const insertChunkSize = options.insertChunkSize ?? DEFAULT_INSERT_CHUNK_SIZE;

	/**
	 * Read the occurrences an observation batch names, so every row carries the library and
	 * canonical identity the projection's indexes are built on.
	 *
	 * Resolved here rather than accepted from the caller for two reasons: a wrong
	 * `library_section_key` would silently move a title into another library's rollup, and
	 * `canonicalIdentityKey` is the only thing keeping movie 105 and show 105 apart.
	 */
	async function resolveOccurrences(
		observations: CoverageObservation[]
	): Promise<Map<number, Occurrence>> {
		const ids = [...new Set(observations.map((observation) => observation.mediaItemId))];
		const resolved = new Map<number, Occurrence>();
		if (ids.length === 0) return resolved;

		for (const batch of chunk(ids, insertChunkSize)) {
			const rows = await database
				.select({
					id: mediaItems.id,
					serverInstanceId: mediaItems.serverInstanceId,
					sectionKey: mediaItems.sectionKey,
					mediaType: mediaItems.mediaType,
					tmdbId: mediaItems.tmdbId
				})
				.from(mediaItems)
				.where(inArray(mediaItems.id, batch));
			for (const row of rows) {
				resolved.set(row.id, {
					// The owner travels with the occurrence so a cross-server observation fails with
					// a typed error instead of the database trigger's raw `scope_mismatch:` abort.
					serverInstanceId: row.serverInstanceId,
					librarySectionKey: row.sectionKey,
					canonicalKey: canonicalIdentityKey(row.mediaType, row.tmdbId)
				});
			}
		}
		return resolved;
	}

	function toRow(
		observation: CoverageObservation,
		occurrence: Occurrence,
		now: Date
	): NewCoverageRow {
		return {
			serverInstanceId: observation.serverInstanceId,
			mediaItemId: observation.mediaItemId,
			librarySectionKey: occurrence.librarySectionKey,
			canonicalKey: occurrence.canonicalKey,
			destination: observation.destination,
			kind: observation.kind,
			season: observation.season ?? null,
			episode: observation.episode ?? null,
			status: observation.status,
			evidenceSource: observation.evidenceSource.trim(),
			evidenceRevisionId: observation.evidenceRevisionId ?? null,
			evidenceFingerprint: observation.evidenceFingerprint ?? null,
			evidenceDetail: observation.evidenceDetail ?? null,
			observedAt: observation.observedAt ?? now,
			updatedAt: now
		};
	}

	async function prepare(
		observations: CoverageObservation[],
		now: Date
	): Promise<NewCoverageRow[]> {
		// Validate the whole batch before writing anything. A reconciliation pass that half
		// applies is worse than one that fails: the projection would then mix two vintages of
		// evidence with no way to tell which slot came from which.
		const normalized = observations.map(normalizeObservation);
		const occurrences = await resolveOccurrences(normalized);
		return normalized.map((observation) => {
			const occurrence = occurrences.get(observation.mediaItemId);
			if (!occurrence || occurrence.serverInstanceId !== observation.serverInstanceId) {
				throw new CoverageStoreError(
					'unknown_occurrence',
					`Media item ${observation.mediaItemId} does not exist on server ${observation.serverInstanceId}`
				);
			}
			return toRow(observation, occurrence, now);
		});
	}

	/**
	 * Upsert observations, leaving every slot they do not mention untouched.
	 *
	 * This is the incremental path used after an apply, an undo, or a single verification.
	 * Each slot is deleted and re-inserted rather than upserted through `ON CONFLICT`: the
	 * three slot shapes have three different partial unique indexes, and one NULL-aware
	 * delete addresses all of them without the caller having to know which applies.
	 */
	async function record(observations: CoverageObservation[]): Promise<number> {
		if (observations.length === 0) return 0;
		const now = clock();
		const rows = await prepare(observations, now);

		await serializeWrite(() =>
			database.transaction(async (tx) => {
				for (const row of rows) {
					await tx
						.delete(artworkCoverage)
						.where(
							and(
								eq(artworkCoverage.serverInstanceId, row.serverInstanceId),
								eq(artworkCoverage.mediaItemId, row.mediaItemId),
								eq(artworkCoverage.destination, row.destination),
								coverageSlotCondition(row)
							)
						);
					await tx.insert(artworkCoverage).values(row);
				}
			})
		);
		return rows.length;
	}

	/**
	 * Replace an entire slice of the projection in one transaction.
	 *
	 * This is what makes the store rebuildable: reconcile a scope from its sources, hand the
	 * result here, and the previous evidence for that scope disappears with it — including
	 * rows for slots that are no longer observed at all, which an upsert-only path would
	 * strand forever. Nothing outside `scope` is touched, so rebuilding one library never
	 * blanks another.
	 */
	async function replace(
		scope: CoverageScope,
		observations: CoverageObservation[]
	): Promise<{ deleted: number; written: number }> {
		const now = clock();
		const rows = await prepare(observations, now);
		for (const row of rows) {
			if (!inScope(row, scope)) {
				throw new CoverageStoreError(
					'scope_mismatch',
					`Observation for media item ${row.mediaItemId} falls outside the rebuilt scope`
				);
			}
		}

		return serializeWrite(() =>
			database.transaction(async (tx) => {
				const removed = await tx
					.delete(artworkCoverage)
					.where(scopeCondition(scope))
					.returning({ id: artworkCoverage.id });
				for (const batch of chunk(rows, insertChunkSize)) {
					await tx.insert(artworkCoverage).values(batch);
				}
				return { deleted: removed.length, written: rows.length };
			})
		);
	}

	/**
	 * Drop a slice of the projection without writing anything back.
	 *
	 * The documented rollback path: coverage can be discarded and recomputed later without
	 * altering artwork, YAML, revisions, or review state.
	 */
	async function clear(scope: CoverageScope): Promise<number> {
		const removed = await serializeWrite(() =>
			database
				.delete(artworkCoverage)
				.where(scopeCondition(scope))
				.returning({ id: artworkCoverage.id })
		);
		return removed.length;
	}

	/** Every destination and slot observed for one occurrence, for the item detail pane. */
	async function getItemCoverage(
		serverInstanceId: string,
		mediaItemId: number
	): Promise<CoverageRow[]> {
		return database
			.select()
			.from(artworkCoverage)
			.where(
				and(
					eq(artworkCoverage.serverInstanceId, serverInstanceId),
					eq(artworkCoverage.mediaItemId, mediaItemId)
				)
			)
			.orderBy(
				asc(artworkCoverage.destination),
				asc(artworkCoverage.kind),
				asc(artworkCoverage.season),
				asc(artworkCoverage.episode)
			);
	}

	/**
	 * Status counts across a library. Zero-filled from the shared vocabulary so a caller
	 * never has to distinguish "no rows with this status" from "this status is missing from
	 * the result set", and so an absent status cannot be rendered as an absent concept.
	 */
	async function countByStatus(scope: CoverageScope): Promise<CoverageStatusCounts> {
		const rows = await database
			.select({ status: artworkCoverage.status, count: sql<number>`count(*)` })
			.from(artworkCoverage)
			.where(scopeCondition(scope))
			.groupBy(artworkCoverage.status);

		const statuses = scope.destination ? statusesFor(scope.destination) : COVERAGE_STATUSES;
		const byStatus: Record<string, number> = Object.fromEntries(
			statuses.map((status) => [status, 0])
		);
		let total = 0;
		for (const row of rows) {
			const count = Number(row.count);
			byStatus[row.status] = count;
			total += count;
		}
		return { byStatus, total };
	}

	/**
	 * The oldest observations on a server, for staleness-driven re-reconciliation.
	 *
	 * Coverage going stale is the projection's central risk: nothing tells us when a user
	 * changed a poster in Plex directly. Surfacing the oldest evidence lets the caller
	 * re-observe it rather than keep presenting it as current.
	 */
	async function listStale(options: ListStaleCoverageOptions): Promise<CoverageRow[]> {
		return database
			.select()
			.from(artworkCoverage)
			.where(
				and(
					eq(artworkCoverage.serverInstanceId, options.serverInstanceId),
					lt(artworkCoverage.observedAt, options.observedBefore)
				)
			)
			.orderBy(asc(artworkCoverage.observedAt))
			.limit(options.limit ?? 100);
	}

	return { record, replace, clear, getItemCoverage, countByStatus, listStale };
}

export type CoverageStore = ReturnType<typeof createCoverageStore>;

/** The singleton every trigger, job, and query path should write through. */
export const coverageStore = createCoverageStore(db);
