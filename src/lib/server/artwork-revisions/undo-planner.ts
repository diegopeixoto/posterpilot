import {
	and,
	desc,
	eq,
	inArray,
	isNotNull,
	isNull,
	ne,
	sql,
	type SQL,
	type SQLWrapper
} from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	artworkRevisions,
	artworkSlotStates,
	artworkSnapshots,
	mediaCollections,
	mediaItems
} from '$lib/server/db/schema';
import type { ApplyServerRegistry } from '$lib/server/plans/apply-server-registry';
import { canonicalJson, hashCanonicalJson } from '$lib/server/plans/canonical-json';
import { sha256Bytes } from '$lib/server/revisions/verification';
import {
	kometaSlotFingerprint,
	readKometaSlot,
	type KometaSlotSnapshotValue
} from '$lib/server/revisions/kometa-state';
import {
	assertUndoPlanPayload,
	buildUndoPlan,
	UNDO_PLAN_KIND,
	type FrozenUndoCurrentState,
	type FrozenUndoSnapshot,
	type UndoPlanCandidate,
	type UndoPlanDestination,
	type UndoPlanPayloadV1,
	type UndoPlanScope,
	type UndoPlanSlot,
	type UndoPlanSummary,
	type UndoPlanTarget
} from './undo-plan';

type Database = LibSQLDatabase<typeof schema>;

export type ArtworkUndoPlannerErrorCode =
	| 'invalid_scope'
	| 'undo_scope_not_found'
	| 'revision_already_undone'
	| 'target_scope_mismatch'
	| 'snapshot_scope_mismatch'
	| 'server_scope_mismatch'
	| 'target_unresolved'
	| 'plan_persist_failed'
	| 'invalid_plan'
	| 'plan_scope_mismatch'
	| 'plan_stale';

/** Locale-neutral planning failure. Route adapters decide the public status/copy. */
export class ArtworkUndoPlannerError extends Error {
	constructor(
		readonly code: ArtworkUndoPlannerErrorCode,
		readonly recordId: string | null = null
	) {
		super(code);
		this.name = 'ArtworkUndoPlannerError';
	}
}

export interface UndoStoredOperationPlan<T> {
	id: string;
	kind: string;
	serverInstanceId: string | null;
	payload: T;
	digest: string;
	expiresAt: Date;
	consumedAt?: Date | null;
}

/** Structural subset of the durable, compare-and-set single-use plan store. */
export interface UndoOperationPlanStore {
	create<T>(input: {
		kind: string;
		payload: T;
		serverInstanceId?: string | null;
		ttlMs?: number;
	}): Promise<UndoStoredOperationPlan<T>>;
	validate<T = unknown>(
		id: string,
		expectations?: {
			kind?: string;
			digest?: string;
			payload?: unknown;
			serverInstanceId?: string | null;
		}
	): Promise<UndoStoredOperationPlan<T>>;
	consume<T = unknown>(
		id: string,
		expectations?: {
			kind?: string;
			digest?: string;
			payload?: unknown;
			serverInstanceId?: string | null;
		}
	): Promise<UndoStoredOperationPlan<T>>;
}

/**
 * Return the current PosterPilot-managed YAML, `null` when the file does not
 * exist, or `undefined` when it cannot be observed. Throws are also treated as
 * an unavailable observation. No raw YAML leaves this module.
 */
export type UndoKometaReader = (serverInstanceId: string) => Promise<string | null | undefined>;

export interface ArtworkUndoPlannerDependencies {
	database: Database;
	serverRegistry: ApplyServerRegistry;
	readKometa: UndoKometaReader;
	planStore: UndoOperationPlanStore;
	clock?: () => Date;
}

export interface CreateArtworkUndoPreviewInput {
	scope: UndoPlanScope;
	ttlMs?: number;
}

export interface ConfirmArtworkUndoPlanInput {
	planId: string;
	digest: string;
	serverInstanceId: string;
	/** Optional route/UI scope that must equal the frozen payload scope exactly. */
	scope?: UndoPlanScope;
}

export interface ConfirmedArtworkUndoPlan {
	planId: string;
	digest: string;
	payload: UndoPlanPayloadV1;
}

export interface PublicUndoPreviewOperation {
	id: string;
	revisionId: string;
	revisionGroupId: string;
	beforeSnapshotId: string;
	serverInstanceId: string;
	target: UndoPlanTarget;
	destination: UndoPlanDestination;
	slot: UndoPlanSlot;
	current: {
		state: FrozenUndoCurrentState['state'];
		artworkVersion: number | null;
	};
	snapshot: {
		state: FrozenUndoSnapshot['state'];
		restorable: boolean;
	};
}

/** Credentials-safe preview: only identities, categorical state, counts, and digest. */
export interface ArtworkUndoPreview {
	planId: string;
	digest: string;
	scope: UndoPlanScope;
	operations: PublicUndoPreviewOperation[];
	summary: UndoPlanSummary;
}

interface RevisionRow {
	id: string;
	groupId: string;
	serverInstanceId: string;
	mediaItemId: number | null;
	mediaCollectionId: string | null;
	beforeSnapshotId: string;
	destination: UndoPlanDestination;
	kind: UndoPlanSlot['kind'];
	season: number | null;
	episode: number | null;
	createdAt: Date;
}

interface ItemTargetRecord {
	target: Extract<UndoPlanTarget, { kind: 'item' }>;
	ratingKey: string;
	tmdbId: string | null;
	rootArtworkVersion: number;
}

interface CollectionTargetRecord {
	target: Extract<UndoPlanTarget, { kind: 'collection' }>;
	source: 'tmdb' | 'native';
	sourceId: string;
	tmdbId: string | null;
	rootArtworkVersion: null;
}

type TargetRecord = ItemTargetRecord | CollectionTargetRecord;

const SHA256 = /^[a-f0-9]{64}$/;

function plannerError(code: ArtworkUndoPlannerErrorCode, recordId?: string | null): never {
	throw new ArtworkUndoPlannerError(code, recordId ?? null);
}

function checkedNow(clock: () => Date): Date {
	const now = new Date(clock().getTime());
	if (!Number.isFinite(now.getTime())) plannerError('invalid_scope');
	return now;
}

function validPositiveInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) > 0;
}

function validNonNegativeInteger(value: unknown): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validIdentifier(value: unknown): value is string {
	return typeof value === 'string' && value.length > 0 && value.trim() === value;
}

function assertTarget(target: UndoPlanTarget): void {
	if (target.kind === 'item') {
		if (!validPositiveInteger(target.mediaItemId)) plannerError('invalid_scope');
		return;
	}
	if (!validIdentifier(target.mediaCollectionId)) plannerError('invalid_scope');
}

function assertSlot(slot: UndoPlanSlot): void {
	if (!['poster', 'background', 'title_card'].includes(slot.kind)) {
		plannerError('invalid_scope');
	}
	if (slot.season !== null && !validNonNegativeInteger(slot.season)) {
		plannerError('invalid_scope');
	}
	if (slot.episode !== null && !validNonNegativeInteger(slot.episode)) {
		plannerError('invalid_scope');
	}
	if (slot.kind === 'title_card') {
		if (slot.season === null || slot.episode === null) plannerError('invalid_scope');
	} else if (slot.episode !== null) {
		plannerError('invalid_scope');
	}
}

function assertScope(scope: UndoPlanScope): void {
	if (!validIdentifier(scope.serverInstanceId)) plannerError('invalid_scope');
	switch (scope.kind) {
		case 'revision':
			if (!validIdentifier(scope.revisionId)) plannerError('invalid_scope');
			return;
		case 'slot':
			assertTarget(scope.target);
			assertSlot(scope.slot);
			return;
		case 'season':
			if (!validPositiveInteger(scope.mediaItemId) || !validNonNegativeInteger(scope.season)) {
				plannerError('invalid_scope');
			}
			return;
		case 'item':
			if (!validPositiveInteger(scope.mediaItemId)) plannerError('invalid_scope');
			return;
		case 'destination':
			assertTarget(scope.target);
			if (scope.destination !== 'server' && scope.destination !== 'kometa') {
				plannerError('invalid_scope');
			}
			return;
		case 'group':
			if (!validIdentifier(scope.revisionGroupId)) plannerError('invalid_scope');
	}
}

function nullable(column: SQLWrapper, value: number | null): SQL {
	return value === null ? isNull(column) : sql`${column} = ${value}`;
}

function revisionTargetPredicates(target: UndoPlanTarget): SQL[] {
	return target.kind === 'item'
		? [
				eq(artworkRevisions.mediaItemId, target.mediaItemId),
				isNull(artworkRevisions.mediaCollectionId)
			]
		: [
				isNull(artworkRevisions.mediaItemId),
				eq(artworkRevisions.mediaCollectionId, target.mediaCollectionId)
			];
}

function revisionScopePredicates(scope: UndoPlanScope): SQL[] {
	switch (scope.kind) {
		case 'revision':
			return [eq(artworkRevisions.id, scope.revisionId)];
		case 'slot':
			return [
				...revisionTargetPredicates(scope.target),
				eq(artworkRevisions.kind, scope.slot.kind),
				nullable(artworkRevisions.season, scope.slot.season),
				nullable(artworkRevisions.episode, scope.slot.episode)
			];
		case 'season':
			return [
				eq(artworkRevisions.mediaItemId, scope.mediaItemId),
				isNull(artworkRevisions.mediaCollectionId),
				eq(artworkRevisions.season, scope.season)
			];
		case 'item':
			return [
				eq(artworkRevisions.mediaItemId, scope.mediaItemId),
				isNull(artworkRevisions.mediaCollectionId)
			];
		case 'destination':
			return [
				...revisionTargetPredicates(scope.target),
				eq(artworkRevisions.destination, scope.destination)
			];
		case 'group':
			return [eq(artworkRevisions.groupId, scope.revisionGroupId)];
	}
}

async function loadRevisionRows(database: Database, scope: UndoPlanScope): Promise<RevisionRow[]> {
	const rows = await database
		.select({
			id: artworkRevisions.id,
			groupId: artworkRevisions.groupId,
			serverInstanceId: artworkRevisions.serverInstanceId,
			mediaItemId: artworkRevisions.mediaItemId,
			mediaCollectionId: artworkRevisions.mediaCollectionId,
			beforeSnapshotId: artworkRevisions.beforeSnapshotId,
			destination: artworkRevisions.destination,
			kind: artworkRevisions.kind,
			season: artworkRevisions.season,
			episode: artworkRevisions.episode,
			createdAt: artworkRevisions.createdAt
		})
		.from(artworkRevisions)
		.where(
			and(
				eq(artworkRevisions.serverInstanceId, scope.serverInstanceId),
				eq(artworkRevisions.outcome, 'success'),
				ne(artworkRevisions.action, 'external_observation'),
				isNotNull(artworkRevisions.beforeSnapshotId),
				...revisionScopePredicates(scope)
			)
		)
		.orderBy(desc(artworkRevisions.createdAt), desc(artworkRevisions.id));

	const candidates = rows.flatMap((row) =>
		row.beforeSnapshotId ? [{ ...row, beforeSnapshotId: row.beforeSnapshotId } as RevisionRow] : []
	);
	if (!candidates.length) return [];
	const undone = await database
		.select({ revisionId: artworkRevisions.undoOfRevisionId })
		.from(artworkRevisions)
		.where(
			and(
				eq(artworkRevisions.serverInstanceId, scope.serverInstanceId),
				eq(artworkRevisions.action, 'undo'),
				eq(artworkRevisions.outcome, 'success'),
				isNotNull(artworkRevisions.undoOfRevisionId),
				inArray(
					artworkRevisions.undoOfRevisionId,
					candidates.map((candidate) => candidate.id)
				)
			)
		);
	const restored = new Set(
		undone.flatMap((row) => (row.revisionId === null ? [] : [row.revisionId]))
	);
	return candidates.filter((candidate) => !restored.has(candidate.id));
}

async function assertRevisionNotUndone(database: Database, scope: UndoPlanScope): Promise<void> {
	if (scope.kind !== 'revision') return;
	const [undo] = await database
		.select({ id: artworkRevisions.id })
		.from(artworkRevisions)
		.where(
			and(
				eq(artworkRevisions.serverInstanceId, scope.serverInstanceId),
				eq(artworkRevisions.undoOfRevisionId, scope.revisionId),
				eq(artworkRevisions.action, 'undo'),
				eq(artworkRevisions.outcome, 'success')
			)
		)
		.limit(1);
	if (undo) plannerError('revision_already_undone', scope.revisionId);
}

function newestDestinationSlots(rows: RevisionRow[]): RevisionRow[] {
	const selected = new Map<string, RevisionRow>();
	for (const row of rows) {
		const target =
			row.mediaItemId !== null
				? `item:${row.mediaItemId}`
				: `collection:${row.mediaCollectionId ?? ''}`;
		const key = [
			row.serverInstanceId,
			target,
			row.destination,
			row.kind,
			row.season ?? 'root',
			row.episode ?? 'root'
		].join('|');
		// The query is newest-first, matching undo-plan's deterministic winner.
		if (!selected.has(key)) selected.set(key, row);
	}
	return [...selected.values()];
}

async function loadTargetRecord(
	database: Database,
	serverInstanceId: string,
	row: RevisionRow
): Promise<TargetRecord> {
	const hasItem = row.mediaItemId !== null;
	const hasCollection = row.mediaCollectionId !== null;
	if (hasItem === hasCollection) plannerError('target_scope_mismatch', row.id);
	if (row.mediaItemId !== null) {
		const [item] = await database
			.select({
				id: mediaItems.id,
				ratingKey: mediaItems.ratingKey,
				tmdbId: mediaItems.tmdbId,
				artworkVersion: mediaItems.artworkVersion
			})
			.from(mediaItems)
			.where(
				and(eq(mediaItems.id, row.mediaItemId), eq(mediaItems.serverInstanceId, serverInstanceId))
			)
			.limit(1);
		if (!item) plannerError('target_scope_mismatch', row.id);
		return {
			target: { kind: 'item', mediaItemId: item.id },
			ratingKey: item.ratingKey,
			tmdbId: item.tmdbId,
			rootArtworkVersion: item.artworkVersion
		};
	}

	const [collection] = await database
		.select({
			id: mediaCollections.id,
			source: mediaCollections.source,
			sourceId: mediaCollections.sourceId
		})
		.from(mediaCollections)
		.where(
			and(
				eq(mediaCollections.id, row.mediaCollectionId!),
				eq(mediaCollections.serverInstanceId, serverInstanceId)
			)
		)
		.limit(1);
	if (!collection) plannerError('target_scope_mismatch', row.id);
	return {
		target: { kind: 'collection', mediaCollectionId: collection.id },
		source: collection.source,
		sourceId: collection.sourceId,
		tmdbId: collection.source === 'tmdb' ? collection.sourceId : null,
		rootArtworkVersion: null
	};
}

function targetSnapshotPredicates(target: UndoPlanTarget): SQL[] {
	return target.kind === 'item'
		? [
				eq(artworkSnapshots.mediaItemId, target.mediaItemId),
				isNull(artworkSnapshots.mediaCollectionId)
			]
		: [
				isNull(artworkSnapshots.mediaItemId),
				eq(artworkSnapshots.mediaCollectionId, target.mediaCollectionId)
			];
}

async function loadBeforeSnapshot(
	database: Database,
	row: RevisionRow,
	target: UndoPlanTarget,
	slot: UndoPlanSlot
) {
	const [snapshot] = await database
		.select({
			id: artworkSnapshots.id,
			state: artworkSnapshots.state,
			sha256: artworkSnapshots.sha256,
			storagePath: artworkSnapshots.storagePath,
			value: artworkSnapshots.value
		})
		.from(artworkSnapshots)
		.where(
			and(
				eq(artworkSnapshots.id, row.beforeSnapshotId),
				eq(artworkSnapshots.serverInstanceId, row.serverInstanceId),
				...targetSnapshotPredicates(target),
				eq(artworkSnapshots.destination, row.destination),
				eq(artworkSnapshots.kind, slot.kind),
				slot.season === null
					? isNull(artworkSnapshots.season)
					: eq(artworkSnapshots.season, slot.season),
				slot.episode === null
					? isNull(artworkSnapshots.episode)
					: eq(artworkSnapshots.episode, slot.episode)
			)
		)
		.limit(1);
	if (!snapshot) plannerError('snapshot_scope_mismatch', row.beforeSnapshotId);
	return snapshot;
}

function kometaSnapshotValue(value: unknown): KometaSlotSnapshotValue | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	const candidate = value as Record<string, unknown>;
	return candidate.state === 'present' &&
		typeof candidate.url === 'string' &&
		candidate.url.length > 0
		? { state: 'present', url: candidate.url }
		: candidate.state === 'absent' && candidate.url === null
			? { state: 'absent', url: null }
			: null;
}

function classifySnapshot(
	snapshot: Awaited<ReturnType<typeof loadBeforeSnapshot>>,
	destination: UndoPlanDestination
): FrozenUndoSnapshot {
	if (snapshot.state === 'absent') {
		return { state: 'absent', fingerprint: null, restorable: true };
	}
	if (snapshot.state !== 'present') {
		return { state: 'unavailable', fingerprint: null, restorable: false };
	}
	if (destination === 'server') {
		return snapshot.sha256 && SHA256.test(snapshot.sha256) && Boolean(snapshot.storagePath)
			? { state: 'present', fingerprint: snapshot.sha256, restorable: true }
			: { state: 'unavailable', fingerprint: null, restorable: false };
	}
	const value = kometaSnapshotValue(snapshot.value);
	return value
		? { state: 'present', fingerprint: kometaSlotFingerprint(value), restorable: true }
		: { state: 'unavailable', fingerprint: null, restorable: false };
}

function slotStateTargetPredicates(target: UndoPlanTarget): SQL[] {
	return target.kind === 'item'
		? [
				eq(artworkSlotStates.mediaItemId, target.mediaItemId),
				isNull(artworkSlotStates.mediaCollectionId)
			]
		: [
				isNull(artworkSlotStates.mediaItemId),
				eq(artworkSlotStates.mediaCollectionId, target.mediaCollectionId)
			];
}

async function loadArtworkVersion(
	database: Database,
	serverInstanceId: string,
	target: TargetRecord,
	slot: UndoPlanSlot
): Promise<number | null> {
	const [state] = await database
		.select({ artworkVersion: artworkSlotStates.artworkVersion })
		.from(artworkSlotStates)
		.where(
			and(
				eq(artworkSlotStates.serverInstanceId, serverInstanceId),
				...slotStateTargetPredicates(target.target),
				eq(artworkSlotStates.kind, slot.kind),
				slot.season === null
					? isNull(artworkSlotStates.season)
					: eq(artworkSlotStates.season, slot.season),
				slot.episode === null
					? isNull(artworkSlotStates.episode)
					: eq(artworkSlotStates.episode, slot.episode)
			)
		)
		.limit(1);
	if (state) return state.artworkVersion;
	return target.target.kind === 'item' && slot.season === null && slot.episode === null
		? target.rootArtworkVersion
		: null;
}

function rootTargetId(target: TargetRecord): string {
	return 'ratingKey' in target ? target.ratingKey : target.sourceId;
}

async function resolveServerTargetId(
	server: Awaited<ReturnType<ApplyServerRegistry['resolve']>>['server'],
	target: TargetRecord,
	slot: UndoPlanSlot,
	seasonCache: Map<string, Awaited<ReturnType<typeof server.listSeasons>>>,
	episodeCache: Map<string, Awaited<ReturnType<typeof server.listEpisodes>>>
): Promise<string> {
	const rootId = rootTargetId(target);
	if (slot.season === null) {
		if ('source' in target && target.source !== 'native') {
			plannerError('target_unresolved', target.target.mediaCollectionId);
		}
		return rootId;
	}
	if (target.target.kind === 'collection')
		plannerError('target_unresolved', target.target.mediaCollectionId);
	let seasons = seasonCache.get(rootId);
	if (!seasons) {
		seasons = await server.listSeasons(rootId);
		seasonCache.set(rootId, seasons);
	}
	const season = seasons.find((candidate) => candidate.number === slot.season);
	if (!season)
		plannerError('target_unresolved', `${target.target.mediaItemId}:season:${slot.season}`);
	if (slot.episode === null) return season.id;
	let episodes = episodeCache.get(season.id);
	if (!episodes) {
		episodes = await server.listEpisodes(season.id);
		episodeCache.set(season.id, episodes);
	}
	const episode = episodes.find((candidate) => candidate.number === slot.episode);
	if (!episode) {
		plannerError(
			'target_unresolved',
			`${target.target.mediaItemId}:season:${slot.season}:episode:${slot.episode}`
		);
	}
	return episode.id;
}

async function readCurrentServerState(
	server: Awaited<ReturnType<ApplyServerRegistry['resolve']>>['server'],
	target: TargetRecord,
	targetId: string,
	slot: UndoPlanSlot,
	artworkVersion: number | null
): Promise<FrozenUndoCurrentState> {
	const collectionTarget = target.target.kind === 'collection';
	if (collectionTarget ? !server.readCollectionArtwork : !server.readArtwork) {
		return { state: 'unavailable', fingerprint: null, artworkVersion };
	}
	try {
		const kind = slot.kind === 'background' ? 'background' : 'poster';
		const artwork = collectionTarget
			? await server.readCollectionArtwork!(targetId, kind)
			: await server.readArtwork!(targetId, kind);
		return artwork
			? { state: 'present', fingerprint: sha256Bytes(artwork.data), artworkVersion }
			: { state: 'absent', fingerprint: null, artworkVersion };
	} catch {
		return { state: 'unavailable', fingerprint: null, artworkVersion };
	}
}

async function readCurrentKometaState(
	readKometa: UndoKometaReader,
	serverInstanceId: string,
	tmdbId: string,
	slot: UndoPlanSlot,
	artworkVersion: number | null
): Promise<FrozenUndoCurrentState> {
	try {
		const raw = await readKometa(serverInstanceId);
		if (raw === undefined) {
			return { state: 'unavailable', fingerprint: null, artworkVersion };
		}
		const value = readKometaSlot(raw ?? '', tmdbId, slot);
		return {
			state: value.state,
			fingerprint: value.state === 'present' ? kometaSlotFingerprint(value) : null,
			artworkVersion
		};
	} catch {
		return { state: 'unavailable', fingerprint: null, artworkVersion };
	}
}

function kometaTargetId(target: TargetRecord): { tmdbId: string; targetId: string } {
	if (!target.tmdbId) {
		plannerError(
			'target_unresolved',
			target.target.kind === 'item'
				? String(target.target.mediaItemId)
				: target.target.mediaCollectionId
		);
	}
	return { tmdbId: target.tmdbId, targetId: `kometa:${target.tmdbId}` };
}

type UndoServerBinding = Awaited<ReturnType<ApplyServerRegistry['resolve']>>;

async function resolveServerBinding(
	dependencies: ArtworkUndoPlannerDependencies,
	serverInstanceId: string
): Promise<UndoServerBinding> {
	let binding: UndoServerBinding;
	try {
		binding = await dependencies.serverRegistry.resolve(serverInstanceId);
	} catch {
		plannerError('server_scope_mismatch', serverInstanceId);
	}
	if (
		binding.serverInstanceId !== serverInstanceId ||
		(binding.server.identity.instanceId !== null &&
			binding.server.identity.instanceId !== serverInstanceId)
	) {
		plannerError('server_scope_mismatch', serverInstanceId);
	}
	return binding;
}

async function materializeRevisionCandidates(
	dependencies: ArtworkUndoPlannerDependencies,
	serverInstanceId: string,
	binding: UndoServerBinding,
	revisions: RevisionRow[]
): Promise<UndoPlanCandidate[]> {
	const targetCache = new Map<string, Promise<TargetRecord>>();
	const seasonCache = new Map<string, Awaited<ReturnType<typeof binding.server.listSeasons>>>();
	const episodeCache = new Map<string, Awaited<ReturnType<typeof binding.server.listEpisodes>>>();
	let kometaRead: Promise<string | null | undefined> | null = null;
	const readKometaOnce: UndoKometaReader = async (requestedServerInstanceId) => {
		if (requestedServerInstanceId !== serverInstanceId) {
			plannerError('server_scope_mismatch', requestedServerInstanceId);
		}
		kometaRead ??= dependencies.readKometa(requestedServerInstanceId);
		return kometaRead;
	};
	const candidates: UndoPlanCandidate[] = [];

	for (const revision of revisions) {
		const targetKey =
			revision.mediaItemId !== null
				? `item:${revision.mediaItemId}`
				: `collection:${revision.mediaCollectionId ?? ''}`;
		let targetPending = targetCache.get(targetKey);
		if (!targetPending) {
			targetPending = loadTargetRecord(dependencies.database, serverInstanceId, revision);
			targetCache.set(targetKey, targetPending);
		}
		const target = await targetPending;
		const slot: UndoPlanSlot = {
			kind: revision.kind,
			season: revision.season,
			episode: revision.episode
		};
		assertSlot(slot);
		const snapshotRow = await loadBeforeSnapshot(
			dependencies.database,
			revision,
			target.target,
			slot
		);
		const snapshot = classifySnapshot(snapshotRow, revision.destination);
		const artworkVersion = await loadArtworkVersion(
			dependencies.database,
			serverInstanceId,
			target,
			slot
		);

		let targetId: string;
		let current: FrozenUndoCurrentState;
		if (revision.destination === 'server') {
			targetId = await resolveServerTargetId(
				binding.server,
				target,
				slot,
				seasonCache,
				episodeCache
			);
			current = await readCurrentServerState(
				binding.server,
				target,
				targetId,
				slot,
				artworkVersion
			);
		} else {
			const kometa = kometaTargetId(target);
			targetId = kometa.targetId;
			current = await readCurrentKometaState(
				readKometaOnce,
				serverInstanceId,
				kometa.tmdbId,
				slot,
				artworkVersion
			);
		}

		candidates.push({
			revisionId: revision.id,
			revisionGroupId: revision.groupId,
			revisionCreatedAt: revision.createdAt.toISOString(),
			serverInstanceId: revision.serverInstanceId,
			target: target.target,
			destination: revision.destination,
			targetId,
			slot,
			beforeSnapshotId: revision.beforeSnapshotId,
			current,
			snapshot
		});
	}

	return candidates;
}

function publicOperation(
	operation: UndoPlanPayloadV1['operations'][number]
): PublicUndoPreviewOperation {
	return {
		id: operation.id,
		revisionId: operation.revisionId,
		revisionGroupId: operation.revisionGroupId,
		beforeSnapshotId: operation.beforeSnapshotId,
		serverInstanceId: operation.serverInstanceId,
		target: operation.target,
		destination: operation.destination,
		slot: operation.slot,
		current: {
			state: operation.current.state,
			artworkVersion: operation.current.artworkVersion
		},
		snapshot: {
			state: operation.snapshot.state,
			restorable: operation.snapshot.restorable
		}
	};
}

function checkedStoredUndoPlan(
	plan: UndoStoredOperationPlan<unknown>,
	serverInstanceId: string
): UndoStoredOperationPlan<UndoPlanPayloadV1> {
	if (
		!plan ||
		!validIdentifier(plan.id) ||
		plan.kind !== UNDO_PLAN_KIND ||
		plan.serverInstanceId !== serverInstanceId ||
		!SHA256.test(plan.digest) ||
		!(plan.expiresAt instanceof Date) ||
		!Number.isFinite(plan.expiresAt.getTime())
	) {
		plannerError('invalid_plan', plan?.id ?? null);
	}
	try {
		assertUndoPlanPayload(plan.payload);
	} catch {
		plannerError('invalid_plan', plan.id);
	}
	if (
		plan.payload.scope.serverInstanceId !== serverInstanceId ||
		hashCanonicalJson(plan.payload) !== plan.digest
	) {
		plannerError('invalid_plan', plan.id);
	}
	return plan as UndoStoredOperationPlan<UndoPlanPayloadV1>;
}

function candidateFromOperation(
	operation: UndoPlanPayloadV1['operations'][number]
): UndoPlanCandidate {
	const { id: _id, ...candidate } = operation;
	return candidate;
}

async function assertFrozenOperationsFresh(
	payload: UndoPlanPayloadV1,
	dependencies: ArtworkUndoPlannerDependencies
): Promise<void> {
	const rows: RevisionRow[] = [];
	try {
		if (payload.scope.kind === 'revision') {
			await assertRevisionNotUndone(dependencies.database, payload.scope);
		}
		for (const operation of payload.operations) {
			const exact = await loadRevisionRows(dependencies.database, {
				kind: 'revision',
				serverInstanceId: payload.scope.serverInstanceId,
				revisionId: operation.revisionId
			});
			if (exact.length !== 1) plannerError('plan_stale', operation.revisionId);
			rows.push(exact[0]);
		}
		const binding = await resolveServerBinding(dependencies, payload.scope.serverInstanceId);
		const fresh = await materializeRevisionCandidates(
			dependencies,
			payload.scope.serverInstanceId,
			binding,
			rows
		);
		const byRevision = new Map(fresh.map((candidate) => [candidate.revisionId, candidate]));
		for (const operation of payload.operations) {
			const candidate = byRevision.get(operation.revisionId);
			if (
				!candidate ||
				canonicalJson(candidate) !== canonicalJson(candidateFromOperation(operation))
			) {
				plannerError('plan_stale', operation.revisionId);
			}
		}
	} catch (error) {
		if (error instanceof ArtworkUndoPlannerError && error.code === 'plan_stale') throw error;
		if (error instanceof ArtworkUndoPlannerError) {
			plannerError('plan_stale', error.recordId);
		}
		throw error;
	}
}

/**
 * Re-read every exact revision, before-snapshot, provider target, live artwork,
 * Kometa slot, and slot version before atomically consuming the frozen plan.
 */
export async function confirmArtworkUndoPlan(
	input: ConfirmArtworkUndoPlanInput,
	dependencies: ArtworkUndoPlannerDependencies
): Promise<ConfirmedArtworkUndoPlan> {
	if (!validIdentifier(input.planId) || !SHA256.test(input.digest)) {
		plannerError('invalid_plan', input.planId || null);
	}
	if (!validIdentifier(input.serverInstanceId)) plannerError('invalid_scope');
	if (input.scope) {
		assertScope(input.scope);
		if (input.scope.serverInstanceId !== input.serverInstanceId) {
			plannerError('plan_scope_mismatch', input.planId);
		}
	}

	const expectations = {
		kind: UNDO_PLAN_KIND,
		digest: input.digest,
		serverInstanceId: input.serverInstanceId
	};
	const validated = checkedStoredUndoPlan(
		await dependencies.planStore.validate<unknown>(input.planId, expectations),
		input.serverInstanceId
	);
	if (input.scope && canonicalJson(input.scope) !== canonicalJson(validated.payload.scope)) {
		plannerError('plan_scope_mismatch', input.planId);
	}

	await assertFrozenOperationsFresh(validated.payload, dependencies);
	const consumed = checkedStoredUndoPlan(
		await dependencies.planStore.consume<unknown>(input.planId, {
			...expectations,
			payload: validated.payload
		}),
		input.serverInstanceId
	);
	if (
		consumed.id !== validated.id ||
		consumed.digest !== validated.digest ||
		canonicalJson(consumed.payload) !== canonicalJson(validated.payload)
	) {
		plannerError('invalid_plan', input.planId);
	}
	return { planId: consumed.id, digest: consumed.digest, payload: consumed.payload };
}

/**
 * Materialize live destination identities from immutable revision/snapshot rows,
 * then persist the exact internal payload in the single-use operation-plan store.
 */
export function createArtworkUndoPlanner(dependencies: ArtworkUndoPlannerDependencies) {
	const clock = dependencies.clock ?? (() => new Date());

	return async function createArtworkUndoPreview(
		input: CreateArtworkUndoPreviewInput
	): Promise<ArtworkUndoPreview> {
		assertScope(input.scope);
		if (input.ttlMs !== undefined && (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0)) {
			plannerError('invalid_scope');
		}
		await assertRevisionNotUndone(dependencies.database, input.scope);
		const revisions = await loadRevisionRows(dependencies.database, input.scope);
		if (revisions.length === 0) plannerError('undo_scope_not_found');
		const selectedRevisions = newestDestinationSlots(revisions);

		const binding = await resolveServerBinding(dependencies, input.scope.serverInstanceId);
		const candidates = await materializeRevisionCandidates(
			dependencies,
			input.scope.serverInstanceId,
			binding,
			selectedRevisions
		);

		const built = buildUndoPlan({
			plannedAt: checkedNow(clock).toISOString(),
			scope: input.scope,
			operations: candidates
		});
		const stored = await dependencies.planStore.create({
			kind: UNDO_PLAN_KIND,
			payload: built.payload,
			serverInstanceId: input.scope.serverInstanceId,
			...(input.ttlMs === undefined ? {} : { ttlMs: input.ttlMs })
		});
		if (
			stored.kind !== UNDO_PLAN_KIND ||
			stored.serverInstanceId !== input.scope.serverInstanceId ||
			stored.digest !== built.digest
		) {
			plannerError('plan_persist_failed', stored.id);
		}

		return {
			planId: stored.id,
			digest: stored.digest,
			scope: built.payload.scope,
			operations: built.payload.operations.map(publicOperation),
			summary: built.payload.summary
		};
	};
}
