/**
 * When coverage is re-derived, and from what.
 *
 * The projection is a cache over three sources it does not own: the immutable
 * revision ledger, the current per-slot server observation, and the Kometa files
 * on disk. This module gathers those, hands them to the pure reconcilers, and
 * writes the result through the store. It mutates nothing else — no server
 * artwork, no YAML, no manual match, and above all no `reviewedAt`. Workflow
 * completion is the user's statement about their own queue; destination evidence
 * is ours about the world, and reconciling one must never edit the other.
 *
 * Two shapes fall out of that.
 *
 * Refreshing is scoped and replacing, not incremental. `replace()` drops the
 * scope's previous rows in the same transaction that writes the new ones, so a
 * slot that stopped being observed — an undone apply, a Kometa entry a user
 * deleted by hand — disappears instead of lingering as evidence forever.
 *
 * A refresh never fails its trigger. An apply that succeeded and then could not
 * update a cache is still a successful apply, so every call site goes through
 * `refreshCoverageAfter`, which logs and swallows. The store is rebuildable by
 * construction; a skipped refresh costs staleness, which the next trigger or the
 * stale read repairs.
 */

import { join } from 'node:path';
import { and, eq, inArray, isNull, type SQL } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type * as schema from '$lib/server/db/schema';
import {
	artworkRevisions,
	artworkSlotStates,
	artworkSnapshots,
	mediaItems
} from '$lib/server/db/schema';
import { db } from '$lib/server/db';
import { logEvent } from '$lib/server/events';
import { resolveConfig } from '$lib/server/config';
import { readConfig } from '$lib/server/kometa/config-io';
import {
	isCanonicalKometaNumericId,
	isKometaLegacyDestinationV1,
	kometaYamlMappingKey,
	resolveKometaDestination,
	LEGACY_FILENAME,
	type KometaLegacyDestinationV1,
	type KometaMetadataFilename
} from '$lib/server/kometa/destination';
import { observeServerArtworkForCoverage } from './observe-server';
import { recordedKometaDestination } from '$lib/server/kometa/recorded-destination';
import { kometaOutputDirectory } from '$lib/server/plans/apply-destinations';
import { applySlotKey, type ApplySlot } from '$lib/server/plans/apply-plan';
import { readKometaSlot } from '$lib/server/revisions/kometa-state';
import type { CoverageDestination } from '$lib/artwork-coverage';
import { toCoverageOccurrence, type CoverageOccurrence } from './occurrences';
import { coverageSlot, toCoverageObservations } from './observations';
import {
	reconcileKometaCoverage,
	type KometaCoverageRequest,
	type KometaEntryEvidence,
	type KometaFileEvidence,
	type KometaLegacyFileEvidence,
	type UnassignedLegacyEntry
} from './reconcile-kometa';
import {
	reconcileServerCoverage,
	type ServerCoverageRequest,
	type ServerRevisionEvidence,
	type ServerSlotObservation
} from './reconcile-server';
import {
	coverageStore,
	isReobservableCoverage,
	type CoverageRow,
	type CoverageStore
} from './store';

/** The slice of the projection one refresh pass rebuilds. */
export interface CoverageRefreshScope {
	serverInstanceId: string;
	/** `media_items.section_key`, to rebuild one library after a scoped sync. */
	librarySectionKey?: string;
	/** Exact occurrences, for the apply/undo/stale-read paths. */
	mediaItemIds?: number[];
}

export interface CoverageRefreshResult {
	destination: CoverageDestination;
	/** Occurrences that had any evidence to reconcile at this destination. */
	occurrences: number;
	written: number;
	deleted: number;
}

/**
 * Why coverage was re-derived. Locale-neutral and stable: it lands in the event
 * log, where a support bundle has to distinguish "the apply path never ran a
 * refresh" from "it ran and the Kometa directory was unreadable".
 */
export type CoverageRefreshTrigger =
	| 'sync'
	| 'apply'
	| 'undo'
	| 'kometa_migration'
	| 'kometa_config'
	| 'stale_read';

/**
 * How old an item's evidence may be before a read re-observes it.
 *
 * Nothing tells us when someone re-postered a title in Plex directly, so the
 * only defence against silently green coverage is to re-observe on a cadence.
 * Fifteen minutes keeps an item-detail page honest without turning every page
 * load into a write.
 */
export const COVERAGE_MAX_AGE_MS = 15 * 60_000;

/** Media items per evidence query and per replaced scope. SQLite caps bound parameters. */
const SCOPE_CHUNK_SIZE = 200;

type CoverageRefreshDatabase = Pick<LibSQLDatabase<typeof schema>, 'select'>;
type CoverageRefreshStore = Pick<CoverageStore, 'replace' | 'listStale' | 'getItemCoverage'>;

export interface CoverageRefreshDependencies {
	database: CoverageRefreshDatabase;
	store: CoverageRefreshStore;
	/**
	 * The directory the typed and legacy metadata files live in, or `null` when
	 * the installation has no resolvable Kometa output. Null suppresses the Kometa
	 * pass entirely rather than replacing its rows with an empty set — we would be
	 * deleting evidence because we could not look, which is the same mistake as
	 * reporting `missing` for an unreadable file.
	 */
	loadKometaDirectory: () => Promise<string | null>;
	/** Reads a metadata file, returning `null` when it does not exist. May throw. */
	readMetadataFile: (path: string) => string | null;
	/**
	 * Re-reads artwork from the media server for these occurrences, refreshing the
	 * slot-state fingerprints the server pass reconciles from.
	 *
	 * Only the stale sweep uses it, and only it can make that sweep mean anything:
	 * reconciling alone rereads the fingerprints we already had, so a poster
	 * swapped directly in Plex would never be noticed while the row's `observedAt`
	 * advanced anyway — the projection would claim fresh evidence it never
	 * gathered. Injected because this is the one network call in a module that is
	 * otherwise database-only, and absent in tests by design.
	 */
	observeServerArtwork?: (input: {
		serverInstanceId: string;
		mediaItemIds: number[];
	}) => Promise<void>;
	clock?: () => Date;
}

/** The `media_items` columns every occurrence, destination, and identity is derived from. */
const occurrenceColumns = {
	mediaItemId: mediaItems.id,
	itemServerInstanceId: mediaItems.serverInstanceId,
	sectionKey: mediaItems.sectionKey,
	type: mediaItems.type,
	mediaType: mediaItems.mediaType,
	tmdbId: mediaItems.tmdbId,
	tvdbId: mediaItems.tvdbId,
	imdbId: mediaItems.imdbId
};

interface OccurrenceRow {
	mediaItemId: number;
	itemServerInstanceId: string;
	sectionKey: string;
	type: 'movie' | 'show';
	mediaType: 'movie' | 'tv' | null;
	tmdbId: string | null;
	tvdbId: string | null;
	imdbId: string | null;
}

/** One occurrence plus the identifiers only the Kometa pass needs. */
interface RefreshOccurrence extends CoverageOccurrence {
	type: 'movie' | 'show';
	tvdbId: string | null;
	imdbId: string | null;
}

function toRefreshOccurrence(row: OccurrenceRow): RefreshOccurrence {
	return {
		...toCoverageOccurrence({
			serverInstanceId: row.itemServerInstanceId,
			mediaItemId: row.mediaItemId,
			librarySectionKey: row.sectionKey,
			mediaType: row.mediaType,
			tmdbId: row.tmdbId
		}),
		type: row.type,
		tvdbId: row.tvdbId,
		imdbId: row.imdbId
	};
}

/**
 * Accumulates the slots one occurrence is asked about.
 *
 * Absence is computed against *requested* slots, so this set decides which
 * `missing` rows exist at all. It is built from evidence — revisions and current
 * slot observations — never from the shape of the library: materializing a
 * `missing` row for every slot of every episode of every show would dwarf the
 * evidence it surrounds, and an item nobody has ever touched is already reported
 * as uncovered by the projection's absence.
 */
class SlotSet {
	private readonly slots = new Map<string, ApplySlot>();

	add(raw: { kind: string; season: number | null; episode: number | null }): ApplySlot | null {
		const slot = coverageSlot(raw);
		if (!slot) return null;
		this.slots.set(applySlotKey(slot), slot);
		return slot;
	}

	get size(): number {
		return this.slots.size;
	}

	values(): ApplySlot[] {
		return [...this.slots.values()];
	}
}

function chunked<T>(values: readonly T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let index = 0; index < values.length; index += size) {
		chunks.push(values.slice(index, index + size));
	}
	return chunks;
}

/**
 * Split one scope into the sub-scopes a single pass may rebuild.
 *
 * An id list longer than SQLite's bound-parameter budget has to be chunked, and
 * chunking a *replace* is safe precisely because every chunk names its own ids:
 * each sub-scope deletes and rewrites only the occurrences it reconciled.
 */
function scopeChunks(scope: CoverageRefreshScope): CoverageRefreshScope[] {
	if (!scope.mediaItemIds) return [scope];
	const ids = [...new Set(scope.mediaItemIds)];
	if (ids.length === 0) return [];
	return chunked(ids, SCOPE_CHUNK_SIZE).map((mediaItemIds) => ({ ...scope, mediaItemIds }));
}

/** Conditions restricting evidence to the scope's active occurrences on its server. */
function scopeConditions(scope: CoverageRefreshScope): SQL[] {
	const conditions: SQL[] = [
		eq(mediaItems.serverInstanceId, scope.serverInstanceId),
		// A copy that left its library has no artwork on that server to be covered.
		isNull(mediaItems.sourceRemovedAt)
	];
	if (scope.librarySectionKey) {
		conditions.push(eq(mediaItems.sectionKey, scope.librarySectionKey));
	}
	if (scope.mediaItemIds) conditions.push(inArray(mediaItems.id, scope.mediaItemIds));
	return conditions;
}

/**
 * The legacy destination an occurrence can prove is its own.
 *
 * Only a destination a released writer explicitly persisted counts, and only if
 * every revision that recorded one agrees. Two disagreeing records mean the
 * pre-split file lost the distinction between them, and guessing is exactly what
 * turns an ambiguous entry into a wrong badge.
 */
function agreedLegacyDestination(
	records: readonly (KometaLegacyDestinationV1 | null)[]
): KometaLegacyDestinationV1 | null {
	const recorded = records.filter((entry): entry is KometaLegacyDestinationV1 => entry !== null);
	if (recorded.length === 0) return null;
	const [first] = recorded;
	return recorded.every((entry) => entry.key === first.key) ? first : null;
}

/**
 * The bare numeric key a legacy shared file would use for this title, or `null`.
 *
 * Speculative by nature — it is the key an entry *would* have, not one anything
 * recorded — so it is built from the id directly rather than through
 * `kometaYamlMappingKey`, which exists to render destinations that were actually
 * resolved or retained.
 *
 * Canonical-strict on purpose: the reconciler decides whether an entry under
 * this key is ambiguous by testing the same id with
 * `isCanonicalKometaNumericId`, so drafting under a coerced key the decide side
 * rejects (`'0105'` → 105, `'0x10'` → 16) would read an entry the reconciler
 * then reports as never drafted — `missing` for a title whose entry exists.
 */
function legacyCandidateKey(tmdbId: string | number | null | undefined): number | null {
	if (tmdbId === null || tmdbId === undefined) return null;
	const id = String(tmdbId).trim();
	return isCanonicalKometaNumericId(id) ? Number(id) : null;
}

/**
 * Count, per legacy mapping id, the occurrences whose own revisions retain it.
 *
 * "Exactly one claimant" is a server-wide invariant — the shared file predates
 * typed destinations, so two copies of a title in different libraries contest
 * the same YAML line. The accumulation mirrors `refreshKometaScope`'s
 * per-occurrence one (one recorded destination per newly seen slot, then
 * `agreedLegacyDestination` across them) so the server-wide count and the
 * scoped requests cannot classify the same revisions differently.
 */
function countLegacyClaimants(
	rows: readonly {
		mediaItemId: number;
		kind: string;
		season: number | null;
		episode: number | null;
		provenance: Record<string, unknown> | null;
		snapshotMetadata: Record<string, unknown> | null;
	}[]
): Map<string, number> {
	const seenSlots = new Map<number, Set<string>>();
	const records = new Map<number, (KometaLegacyDestinationV1 | null)[]>();
	for (const row of rows) {
		const slot = coverageSlot(row);
		if (!slot) continue;
		let seen = seenSlots.get(row.mediaItemId);
		if (!seen) {
			seen = new Set();
			seenSlots.set(row.mediaItemId, seen);
		}
		const slotKey = applySlotKey(slot);
		if (seen.has(slotKey)) continue;
		seen.add(slotKey);
		const recorded = recordedKometaDestination(row.provenance, row.snapshotMetadata);
		let bucket = records.get(row.mediaItemId);
		if (!bucket) {
			bucket = [];
			records.set(row.mediaItemId, bucket);
		}
		bucket.push(recorded?.version === 1 ? recorded : null);
	}
	const counts = new Map<string, number>();
	for (const bucket of records.values()) {
		const agreed = agreedLegacyDestination(bucket);
		if (!agreed || !isKometaLegacyDestinationV1(agreed)) continue;
		counts.set(agreed.mappingId, (counts.get(agreed.mappingId) ?? 0) + 1);
	}
	return counts;
}

/** Entries are keyed by mapping id, not by occurrence: two copies of one title share a YAML line. */
class EntryDrafts {
	private readonly drafts = new Map<string, { mappingKey: string | number; slots: SlotSet }>();

	add(mappingKey: string | number, slots: readonly ApplySlot[]): void {
		const key = String(mappingKey);
		let draft = this.drafts.get(key);
		if (!draft) {
			draft = { mappingKey, slots: new SlotSet() };
			this.drafts.set(key, draft);
		}
		for (const slot of slots) draft.slots.add(slot);
	}

	get size(): number {
		return this.drafts.size;
	}

	/**
	 * Read every drafted slot out of one file's text.
	 *
	 * A throw here is file-level, not slot-level: `readKometaSlot` validates the
	 * whole managed metadata tree before resolving a path, so a duplicate logical
	 * key or a non-scalar slot anywhere makes every read of that file fail the
	 * same way. Reporting the file unreadable is therefore the honest answer, and
	 * it produces `unknown` rather than marking a fully exported library uncovered.
	 */
	read(raw: string): KometaEntryEvidence[] | null {
		try {
			return [...this.drafts.values()].map((draft) => ({
				mappingKey: draft.mappingKey,
				slots: draft.slots.values().map((slot) => ({
					slot,
					url: readKometaSlot(raw, draft.mappingKey, slot).url
				}))
			}));
		} catch {
			return null;
		}
	}
}

export function createCoverageRefresher(dependencies: CoverageRefreshDependencies) {
	const { database, store, loadKometaDirectory, readMetadataFile } = dependencies;
	const clock = dependencies.clock ?? (() => new Date());

	/**
	 * Reconcile direct-server coverage for one scope.
	 *
	 * The ledger says what we wrote and what fingerprint we expected; the slot
	 * states say what the server serves now. Both are read here and compared by
	 * the pure reconciler, which is why an item somebody re-postered in Plex comes
	 * back `externally_changed` instead of quietly staying green.
	 */
	async function refreshServerScope(scope: CoverageRefreshScope): Promise<CoverageRefreshResult> {
		const conditions = scopeConditions(scope);
		const [revisionRows, slotStateRows] = await Promise.all([
			database
				.select({
					...occurrenceColumns,
					revisionId: artworkRevisions.id,
					revisionServerInstanceId: artworkRevisions.serverInstanceId,
					destination: artworkRevisions.destination,
					action: artworkRevisions.action,
					kind: artworkRevisions.kind,
					season: artworkRevisions.season,
					episode: artworkRevisions.episode,
					outcome: artworkRevisions.outcome,
					verification: artworkRevisions.verification,
					proposedFingerprint: artworkRevisions.proposedFingerprint,
					createdAt: artworkRevisions.createdAt,
					completedAt: artworkRevisions.completedAt
				})
				.from(artworkRevisions)
				.innerJoin(mediaItems, eq(mediaItems.id, artworkRevisions.mediaItemId))
				.where(
					and(
						eq(artworkRevisions.serverInstanceId, scope.serverInstanceId),
						eq(artworkRevisions.destination, 'server'),
						// Collections carry no TMDB identity and are outside canonical coverage.
						isNull(artworkRevisions.mediaCollectionId),
						...conditions
					)
				),
			database
				.select({
					...occurrenceColumns,
					kind: artworkSlotStates.kind,
					season: artworkSlotStates.season,
					episode: artworkSlotStates.episode,
					currentFingerprint: artworkSlotStates.currentFingerprint,
					lastObservedAt: artworkSlotStates.lastObservedAt,
					lastVerifiedAt: artworkSlotStates.lastVerifiedAt,
					externalChangedAt: artworkSlotStates.externalChangedAt
				})
				.from(artworkSlotStates)
				.innerJoin(mediaItems, eq(mediaItems.id, artworkSlotStates.mediaItemId))
				.where(
					and(
						eq(artworkSlotStates.serverInstanceId, scope.serverInstanceId),
						isNull(artworkSlotStates.mediaCollectionId),
						...conditions
					)
				)
		]);

		const occurrences = new Map<number, RefreshOccurrence>();
		const slots = new Map<number, SlotSet>();
		const slotsFor = (row: OccurrenceRow): SlotSet => {
			if (!occurrences.has(row.mediaItemId)) {
				occurrences.set(row.mediaItemId, toRefreshOccurrence(row));
			}
			let set = slots.get(row.mediaItemId);
			if (!set) {
				set = new SlotSet();
				slots.set(row.mediaItemId, set);
			}
			return set;
		};

		const revisions: ServerRevisionEvidence[] = [];
		for (const row of revisionRows) {
			const slot = slotsFor(row).add(row);
			if (!slot) continue;
			revisions.push({
				revisionId: row.revisionId,
				serverInstanceId: row.revisionServerInstanceId,
				mediaItemId: row.mediaItemId,
				mediaCollectionId: null,
				destination: row.destination,
				action: row.action,
				kind: slot.kind,
				season: slot.season,
				episode: slot.episode,
				outcome: row.outcome,
				verification: row.verification,
				proposedFingerprint: row.proposedFingerprint,
				createdAt: row.createdAt,
				completedAt: row.completedAt
			});
		}

		const observations: ServerSlotObservation[] = [];
		for (const row of slotStateRows) {
			// An observation alone never creates a request. A full rescan writes slot
			// states for every item on the server, and turning each one into a
			// `missing` row would materialize the whole library — the projection's
			// contract is that an untouched item has no coverage rows and is reported
			// by the anti-join, so only items our ledger has touched are asked about.
			if (!occurrences.has(row.mediaItemId)) continue;
			const slot = slotsFor(row).add(row);
			if (!slot) continue;
			observations.push({
				serverInstanceId: row.itemServerInstanceId,
				mediaItemId: row.mediaItemId,
				kind: slot.kind,
				season: slot.season,
				episode: slot.episode,
				currentFingerprint: row.currentFingerprint,
				lastObservedAt: row.lastObservedAt,
				lastVerifiedAt: row.lastVerifiedAt,
				externalChangedAt: row.externalChangedAt
			});
		}

		const requests: ServerCoverageRequest[] = [];
		for (const [mediaItemId, set] of slots) {
			const occurrence = occurrences.get(mediaItemId);
			if (!occurrence || set.size === 0) continue;
			requests.push({
				occurrenceKey: occurrence.occurrenceKey,
				serverInstanceId: occurrence.serverInstanceId,
				mediaItemId: occurrence.mediaItemId,
				identityKey: occurrence.identityKey,
				slots: set.values()
			});
		}

		const evidence = reconcileServerCoverage({ requests, revisions, observations });
		const { deleted, written } = await store.replace(
			{ ...scope, destination: 'server' },
			toCoverageObservations(evidence, clock())
		);
		return { destination: 'server', occurrences: requests.length, deleted, written };
	}

	/**
	 * Reconcile Kometa coverage for one scope.
	 *
	 * Requests come from this server's own Kometa revisions rather than from every
	 * item: a Kometa export is something *we* wrote for a specific occurrence, and
	 * an item we never exported has nothing in a metadata file to find. The files
	 * are then read for exactly those mapping ids.
	 */
	async function refreshKometaScope(
		scope: CoverageRefreshScope
	): Promise<CoverageRefreshResult | null> {
		const directory = await loadKometaDirectory();
		if (!directory) return null;

		const revisionRows = await database
			.select({
				...occurrenceColumns,
				kind: artworkRevisions.kind,
				season: artworkRevisions.season,
				episode: artworkRevisions.episode,
				provenance: artworkRevisions.provenance,
				snapshotMetadata: artworkSnapshots.metadata
			})
			.from(artworkRevisions)
			.innerJoin(mediaItems, eq(mediaItems.id, artworkRevisions.mediaItemId))
			.leftJoin(artworkSnapshots, eq(artworkSnapshots.id, artworkRevisions.afterSnapshotId))
			.where(
				and(
					eq(artworkRevisions.serverInstanceId, scope.serverInstanceId),
					eq(artworkRevisions.destination, 'kometa'),
					isNull(artworkRevisions.mediaCollectionId),
					...scopeConditions(scope)
				)
			);

		const occurrences = new Map<number, RefreshOccurrence>();
		const slots = new Map<number, SlotSet>();
		const legacyRecords = new Map<number, (KometaLegacyDestinationV1 | null)[]>();
		for (const row of revisionRows) {
			if (!occurrences.has(row.mediaItemId)) {
				occurrences.set(row.mediaItemId, toRefreshOccurrence(row));
				legacyRecords.set(row.mediaItemId, []);
			}
			let set = slots.get(row.mediaItemId);
			if (!set) {
				set = new SlotSet();
				slots.set(row.mediaItemId, set);
			}
			if (!set.add(row)) continue;
			const recorded = recordedKometaDestination(row.provenance, row.snapshotMetadata);
			legacyRecords.get(row.mediaItemId)!.push(recorded?.version === 1 ? recorded : null);
		}

		const requests: KometaCoverageRequest[] = [];
		const typedDrafts = new Map<KometaMetadataFilename, EntryDrafts>();
		const legacyDrafts = new EntryDrafts();
		for (const [mediaItemId, set] of slots) {
			const occurrence = occurrences.get(mediaItemId);
			if (!occurrence || set.size === 0) continue;
			const resolved = resolveKometaDestination({
				type: occurrence.type,
				tmdbId: occurrence.tmdbId,
				tvdbId: occurrence.tvdbId,
				imdbId: occurrence.imdbId
			});
			const legacyDestination = agreedLegacyDestination(legacyRecords.get(mediaItemId) ?? []);
			const slotValues = set.values();
			requests.push({
				occurrenceKey: occurrence.occurrenceKey,
				serverInstanceId: occurrence.serverInstanceId,
				mediaItemId: occurrence.mediaItemId,
				identityKey: occurrence.identityKey,
				destination: resolved.ok
					? { state: 'resolved', destination: resolved.destination }
					: { state: 'unidentified' },
				legacyDestination,
				tmdbId: occurrence.tmdbId,
				slots: slotValues
			});
			if (resolved.ok) {
				const filename = resolved.destination.filename;
				let drafts = typedDrafts.get(filename);
				if (!drafts) {
					drafts = new EntryDrafts();
					typedDrafts.set(filename, drafts);
				}
				drafts.add(kometaYamlMappingKey(resolved.destination), slotValues);
			}
			const candidateKey = legacyCandidateKey(occurrence.tmdbId);
			if (legacyDestination) {
				legacyDrafts.add(kometaYamlMappingKey(legacyDestination), slotValues);
			} else if (candidateKey !== null) {
				// No revision retained a legacy destination for this occurrence, so this
				// key cannot be proven ours. Draft it anyway: the shared file predates
				// typed mapping and is keyed by bare TMDB number, so an entry under this
				// id may well exist, and the reconciler is what decides — it answers
				// `ambiguous_identity`, leaving coverage unknown and reporting the entry
				// without attributing it to a movie or a show. Not reading would report
				// the file absent instead, which can only be read as "checked, nothing
				// exported" — a claim this evidence does not support.
				legacyDrafts.add(candidateKey, slotValues);
			}
		}

		// "Exactly one claimant" is a server-wide question, but this pass only
		// loaded its own scope's revisions. Whenever a scoped occurrence retains a
		// legacy destination, count claimants across the whole server, or an apply
		// or stale read of one copy would confidently attribute a key its twin in
		// another library still contests. Skipped entirely when nothing in scope
		// retains a legacy id — the normal post-migration state.
		let legacyClaimantCounts: ReadonlyMap<string, number> | undefined;
		const scoped = Boolean(scope.librarySectionKey || scope.mediaItemIds);
		if (scoped && requests.some((request) => request.legacyDestination)) {
			const claimantRows = await database
				.select({
					mediaItemId: mediaItems.id,
					kind: artworkRevisions.kind,
					season: artworkRevisions.season,
					episode: artworkRevisions.episode,
					provenance: artworkRevisions.provenance,
					snapshotMetadata: artworkSnapshots.metadata
				})
				.from(artworkRevisions)
				.innerJoin(mediaItems, eq(mediaItems.id, artworkRevisions.mediaItemId))
				.leftJoin(artworkSnapshots, eq(artworkSnapshots.id, artworkRevisions.afterSnapshotId))
				.where(
					and(
						eq(artworkRevisions.serverInstanceId, scope.serverInstanceId),
						eq(artworkRevisions.destination, 'kometa'),
						isNull(artworkRevisions.mediaCollectionId),
						...scopeConditions({ serverInstanceId: scope.serverInstanceId })
					)
				);
			legacyClaimantCounts = countLegacyClaimants(claimantRows);
		}

		const observedAt = clock();
		const files: KometaFileEvidence[] = [];
		for (const [filename, drafts] of typedDrafts) {
			files.push(readFile(directory, filename, drafts));
		}
		const legacyFile = readLegacyFile(directory, legacyDrafts);

		const { coverage, unassignedLegacyEntries } = reconcileKometaCoverage({
			requests,
			files,
			legacyFile,
			legacyClaimantCounts,
			observedAt
		});
		await reportUnassignedLegacyEntries(scope.serverInstanceId, unassignedLegacyEntries);
		const { deleted, written } = await store.replace(
			{ ...scope, destination: 'kometa' },
			toCoverageObservations(coverage, observedAt)
		);
		return { destination: 'kometa', occurrences: requests.length, deleted, written };
	}

	function readFile(
		directory: string,
		filename: KometaMetadataFilename,
		drafts: EntryDrafts
	): KometaFileEvidence {
		let raw: string | null;
		try {
			raw = readMetadataFile(join(directory, filename));
		} catch {
			return { filename, state: 'unreadable' };
		}
		// A file that does not exist is a reliable observation that nothing is
		// exported there; a file we failed to read is not.
		if (raw === null) return { filename, state: 'absent' };
		const entries = drafts.read(raw);
		return entries === null
			? { filename, state: 'unreadable' }
			: { filename, state: 'parsed', entries };
	}

	function readLegacyFile(directory: string, drafts: EntryDrafts): KometaLegacyFileEvidence {
		// Nothing retained a legacy destination, so no entry in the shared file can
		// be proven to be ours and reading it could only produce guesses.
		if (drafts.size === 0) return { state: 'absent' };
		let raw: string | null;
		try {
			raw = readMetadataFile(join(directory, LEGACY_FILENAME));
		} catch {
			return { state: 'unreadable' };
		}
		if (raw === null) return { state: 'absent' };
		const entries = drafts.read(raw);
		return entries === null ? { state: 'unreadable' } : { state: 'parsed', entries };
	}

	/**
	 * Name the legacy entries that could be ours but cannot be proven to be.
	 *
	 * They are deliberately never folded into a title's coverage, so without this
	 * they would vanish silently — and "the migration screen says nothing and the
	 * poster is unexplained" is the failure mode the whole legacy branch exists to
	 * avoid. Mapping keys are numeric ids, never URLs or paths.
	 */
	async function reportUnassignedLegacyEntries(
		serverInstanceId: string,
		entries: readonly UnassignedLegacyEntry[]
	): Promise<void> {
		if (entries.length === 0) return;
		await logEvent('warn', 'coverage', 'Legacy Kometa entries could not be attributed', {
			serverInstanceId,
			code: 'coverage_legacy_entries_unassigned',
			count: entries.length,
			entries: entries.slice(0, 20)
		});
	}

	async function refreshServerCoverage(
		scope: CoverageRefreshScope
	): Promise<CoverageRefreshResult[]> {
		const results: CoverageRefreshResult[] = [];
		for (const chunk of scopeChunks(scope)) results.push(await refreshServerScope(chunk));
		return results;
	}

	async function refreshKometaCoverage(
		scope: CoverageRefreshScope
	): Promise<CoverageRefreshResult[]> {
		const results: CoverageRefreshResult[] = [];
		for (const chunk of scopeChunks(scope)) {
			const result = await refreshKometaScope(chunk);
			if (result) results.push(result);
		}
		return results;
	}

	/** Rebuild both destinations for a scope. They never imply one another. */
	async function refreshCoverage(scope: CoverageRefreshScope): Promise<CoverageRefreshResult[]> {
		return [...(await refreshServerCoverage(scope)), ...(await refreshKometaCoverage(scope))];
	}

	/**
	 * Re-observe the oldest evidence on a server.
	 *
	 * Coverage going stale is the projection's central risk: nothing tells us when
	 * a user changed a poster directly. This walks the oldest rows rather than the
	 * whole server so the cost stays bounded no matter how large the library is.
	 */
	async function refreshStaleCoverage(input: {
		serverInstanceId: string;
		staleBefore?: Date;
		limit?: number;
	}): Promise<CoverageRefreshResult[]> {
		const rows = await store.listStale({
			serverInstanceId: input.serverInstanceId,
			observedBefore: input.staleBefore ?? new Date(clock().getTime() - COVERAGE_MAX_AGE_MS),
			limit: input.limit
		});
		const mediaItemIds = [...new Set(rows.map((row) => row.mediaItemId))];
		if (mediaItemIds.length === 0) return [];
		// Observe before reconciling, and let a failure propagate rather than
		// reconciling anyway: stamping a fresh `observedAt` onto evidence we did not
		// actually re-check would retire the row from this sweep while leaving a
		// stale `applied_on_server` in place — the external change it exists to catch
		// would then never be caught. Failing keeps the row stale for the next pass.
		await dependencies.observeServerArtwork?.({
			serverInstanceId: input.serverInstanceId,
			mediaItemIds
		});
		return refreshCoverage({ serverInstanceId: input.serverInstanceId, mediaItemIds });
	}

	/**
	 * Read one occurrence's coverage, re-observing it first when it has gone stale.
	 *
	 * An occurrence with no rows at all is not refreshed: it has no evidence to be
	 * stale, the anti-join already reports it as needing artwork, and refreshing on
	 * every detail view would turn a read of an untouched library into a write per
	 * page load. Its first evidence arrives from an apply, a sync, or a rebuild.
	 */
	async function readItemCoverage(
		serverInstanceId: string,
		mediaItemId: number,
		options: { maxAgeMs?: number } = {}
	): Promise<CoverageRow[]> {
		const rows = await store.getItemCoverage(serverInstanceId, mediaItemId);
		const staleBefore = new Date(clock().getTime() - (options.maxAgeMs ?? COVERAGE_MAX_AGE_MS));
		// Only rows a refresh can actually advance count as stale here. A
		// server-destination episode row keeps the `observedAt` its claim pinned, so
		// treating it as stale would re-run observation, file parsing, and a replace
		// on every page load of that title, forever, without changing anything.
		if (
			!rows.some(
				(row) => isReobservableCoverage(row) && row.observedAt.getTime() < staleBefore.getTime()
			)
		) {
			return rows;
		}
		const refreshed = await refreshSafely('stale_read', {
			serverInstanceId,
			mediaItemIds: [mediaItemId]
		});
		// A failed refresh returns the evidence we already had. Stale coverage is
		// still evidence; refusing to render the pane would be strictly worse.
		return refreshed ? store.getItemCoverage(serverInstanceId, mediaItemId) : rows;
	}

	/**
	 * The only entry point a trigger should call.
	 *
	 * Returns whether the refresh completed, and never throws: reconciliation is a
	 * cache update, and an apply, undo, sync, or migration that succeeded must not
	 * be reported as failed because the cache could not be rebuilt afterwards.
	 */
	async function refreshSafely(
		trigger: CoverageRefreshTrigger,
		scope: CoverageRefreshScope
	): Promise<boolean> {
		return swallow(trigger, scope, () => refreshCoverage(scope));
	}

	/**
	 * Re-observe a server's oldest evidence without failing its trigger.
	 *
	 * The bounded variant exists for read paths: a page that inspects a destination
	 * should repair what has gone stale, but must not pay for a whole-server rebuild
	 * before it can render.
	 */
	async function refreshStaleSafely(
		trigger: CoverageRefreshTrigger,
		input: { serverInstanceId: string; staleBefore?: Date; limit?: number }
	): Promise<boolean> {
		return swallow(trigger, { serverInstanceId: input.serverInstanceId }, () =>
			refreshStaleCoverage(input)
		);
	}

	/** One swallow, one event code — so a silent skip is never silent in the log. */
	async function swallow(
		trigger: CoverageRefreshTrigger,
		scope: CoverageRefreshScope,
		run: () => Promise<unknown>
	): Promise<boolean> {
		try {
			await run();
			return true;
		} catch (error) {
			await logEvent('warn', 'coverage', 'Artwork coverage reconciliation failed', {
				serverInstanceId: scope.serverInstanceId,
				code: 'coverage_reconciliation_failed',
				trigger,
				librarySectionKey: scope.librarySectionKey ?? null,
				occurrences: scope.mediaItemIds?.length ?? null,
				error: error instanceof Error ? error.message : String(error)
			});
			return false;
		}
	}

	return {
		refreshServerCoverage,
		refreshKometaCoverage,
		refreshCoverage,
		refreshStaleCoverage,
		readItemCoverage,
		refreshCoverageAfter: refreshSafely,
		refreshStaleCoverageAfter: refreshStaleSafely
	};
}

export type CoverageRefresher = ReturnType<typeof createCoverageRefresher>;

/** The singleton every job, apply, undo, migration, and read path refreshes through. */
export const coverageRefresher = createCoverageRefresher({
	database: db,
	store: coverageStore,
	loadKometaDirectory: async () => kometaOutputDirectory(await resolveConfig()) || null,
	readMetadataFile: readConfig,
	observeServerArtwork: observeServerArtworkForCoverage
});

/**
 * Refresh coverage for a scope without ever failing the operation that triggered it.
 *
 * Call sites use this rather than the refresher directly so the swallow is one
 * decision in one place instead of a try/catch repeated at every trigger.
 */
export function refreshCoverageAfter(
	trigger: CoverageRefreshTrigger,
	scope: CoverageRefreshScope
): Promise<boolean> {
	return coverageRefresher.refreshCoverageAfter(trigger, scope);
}

/** Read one occurrence's coverage, re-observing stale evidence on demand. */
export function readItemCoverage(
	serverInstanceId: string,
	mediaItemId: number,
	options?: { maxAgeMs?: number }
): Promise<CoverageRow[]> {
	return coverageRefresher.readItemCoverage(serverInstanceId, mediaItemId, options);
}

/** Re-observe the oldest evidence on a server. Throws; wrap it at the call site. */
export function refreshStaleCoverage(input: {
	serverInstanceId: string;
	staleBefore?: Date;
	limit?: number;
}): Promise<CoverageRefreshResult[]> {
	return coverageRefresher.refreshStaleCoverage(input);
}

/** Bounded stale sweep for read paths, with the same never-fail-the-trigger contract. */
export function refreshStaleCoverageAfter(
	trigger: CoverageRefreshTrigger,
	input: { serverInstanceId: string; staleBefore?: Date; limit?: number }
): Promise<boolean> {
	return coverageRefresher.refreshStaleCoverageAfter(trigger, input);
}

const inFlightStaleSweeps = new Map<string, Promise<boolean>>();

/**
 * Kick a bounded stale sweep without making the caller wait for it.
 *
 * A sweep re-downloads artwork bytes from the media server — background-job
 * work a page load must never block on. One sweep per server at a time: a
 * second page load while one is running would re-select the same oldest rows
 * and duplicate the downloads rather than repair more.
 */
export function refreshStaleCoverageInBackground(
	trigger: CoverageRefreshTrigger,
	input: { serverInstanceId: string; staleBefore?: Date; limit?: number }
): void {
	if (inFlightStaleSweeps.has(input.serverInstanceId)) return;
	// `refreshStaleCoverageAfter` never rejects, so the chain below cannot leave
	// an unhandled rejection behind.
	const sweep = coverageRefresher
		.refreshStaleCoverageAfter(trigger, input)
		.finally(() => inFlightStaleSweeps.delete(input.serverInstanceId));
	inFlightStaleSweeps.set(input.serverInstanceId, sweep);
}
