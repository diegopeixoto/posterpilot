import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	artworkRevisionGroups,
	artworkRevisions,
	artworkSlotStates,
	jobs,
	mediaCollections,
	mediaItems,
	operationPlans,
	posterCandidates,
	serverInstances,
	type ArtworkRevision,
	type ArtworkRevisionGroup,
	type ArtworkSlotState
} from '$lib/server/db/schema';
import { redactApplyErrorText } from '$lib/server/plans/apply-redaction';
import { sanitizeServerArtworkUrl } from '$lib/server/media-server/artwork-url';

type Database = LibSQLDatabase<typeof schema>;
type RevisionGroupKind = ArtworkRevisionGroup['kind'];
type RevisionAction = ArtworkRevision['action'];
type RevisionDestination = ArtworkRevision['destination'];
type RevisionKind = ArtworkRevision['kind'];
type RevisionOutcome = Exclude<ArtworkRevision['outcome'], 'pending'>;
type RevisionVerification = Exclude<ArtworkRevision['verification'], 'pending'>;

export type ArtworkRevisionLedgerErrorCode =
	| 'revision_group_not_found'
	| 'revision_group_scope_mismatch'
	| 'revision_group_action_mismatch'
	| 'revision_group_completed'
	| 'revision_group_empty'
	| 'revision_group_has_pending_outcomes'
	| 'revision_target_scope_mismatch'
	| 'revision_candidate_scope_mismatch'
	| 'revision_undo_target_not_found'
	| 'revision_undo_scope_mismatch'
	| 'revision_link_not_found'
	| 'revision_link_scope_mismatch';

/** Locale-neutral persistence failure; route adapters can map `code` later. */
class ArtworkRevisionLedgerError extends Error {
	constructor(
		readonly code: ArtworkRevisionLedgerErrorCode,
		readonly recordId: string
	) {
		super(code);
		this.name = 'ArtworkRevisionLedgerError';
	}
}

export interface ArtworkRevisionLedgerOptions {
	clock?: () => Date;
	generateGroupId?: () => string;
	generateRevisionId?: () => string;
}

export interface CreateArtworkRevisionGroupInput {
	serverInstanceId: string;
	operationPlanId?: string | null;
	jobId?: number | null;
	kind: RevisionGroupKind;
	initiator: string;
}

export interface ArtworkSlotStateUpdate {
	/** Internal server URL. It is not copied into candidate provenance or public history copy. */
	currentUrl: string | null;
	currentFingerprint: string | null;
	artworkVersion?: number;
	/** Advance this slot exactly once after a verified mutation. */
	advanceArtworkVersion?: boolean;
	lastObservedAt?: Date | null;
	lastVerifiedAt?: Date | null;
	externalChangedAt?: Date | null;
}

export interface RecordArtworkRevisionOutcomeInput {
	groupId: string;
	serverInstanceId: string;
	mediaItemId?: number | null;
	mediaCollectionId?: string | null;
	undoOfRevisionId?: string | null;
	beforeSnapshotId?: string | null;
	afterSnapshotId?: string | null;
	candidateId?: number | null;
	action: RevisionAction;
	destination: RevisionDestination;
	kind: RevisionKind;
	season?: number | null;
	episode?: number | null;
	applyMethod?: string | null;
	sourceProvider?: string | null;
	provenance?: Record<string, unknown> | null;
	priorFingerprint?: string | null;
	proposedFingerprint?: string | null;
	outcome: RevisionOutcome;
	verification: RevisionVerification;
	errorCode?: string | null;
	error?: string | null;
	/** Optional mutable observation committed atomically with the immutable revision. */
	slotState?: ArtworkSlotStateUpdate | null;
}

export interface RecordedArtworkRevisionOutcome {
	revision: ArtworkRevision;
	currentSlotState: ArtworkSlotState | null;
}

export interface FinalizeArtworkRevisionGroupInput {
	groupId: string;
	serverInstanceId: string;
	/** Caller metadata cannot replace the ledger-computed counts. */
	summary?: Record<string, unknown> | null;
}

export interface ArtworkRevisionTimelineScope {
	serverInstanceId: string;
	mediaItemId?: number | null;
	mediaCollectionId?: string | null;
	limit?: number;
}

export interface ArtworkRevisionTimelineEntry {
	group: ArtworkRevisionGroup;
	revision: ArtworkRevision;
	/** The current server observation for this slot, not a historical reconstruction. */
	currentSlotState: ArtworkSlotState | null;
}

function assertTrimmed(value: string, label: string): void {
	if (!value || value.trim() !== value) {
		throw new TypeError(`${label} must be a non-empty, trimmed string`);
	}
}

function checkedNow(clock: () => Date): Date {
	const value = new Date(clock().getTime());
	if (!Number.isFinite(value.getTime()))
		throw new TypeError('Ledger clock returned an invalid date');
	return value;
}

function assertTarget(input: {
	mediaItemId?: number | null;
	mediaCollectionId?: string | null;
	season?: number | null;
	episode?: number | null;
}): void {
	const hasItem = input.mediaItemId !== null && input.mediaItemId !== undefined;
	const hasCollection = input.mediaCollectionId !== null && input.mediaCollectionId !== undefined;
	if (hasItem === hasCollection) {
		throw new TypeError('Exactly one media item or media collection target is required');
	}
	if (hasItem && (!Number.isInteger(input.mediaItemId) || Number(input.mediaItemId) <= 0)) {
		throw new TypeError('Media item id must be a positive integer');
	}
	if (hasCollection) assertTrimmed(input.mediaCollectionId!, 'Media collection id');
	if (input.season !== null && input.season !== undefined && !Number.isInteger(input.season)) {
		throw new TypeError('Season must be an integer');
	}
	if (input.episode !== null && input.episode !== undefined) {
		if (!Number.isInteger(input.episode)) throw new TypeError('Episode must be an integer');
		if (input.season === null || input.season === undefined) {
			throw new TypeError('Episode scope requires a season');
		}
	}
	if (hasCollection && (input.season != null || input.episode != null)) {
		throw new TypeError('Collection artwork cannot use season or episode scope');
	}
}

function assertOptionalDate(value: Date | null | undefined, label: string): void {
	if (value !== null && value !== undefined && !Number.isFinite(value.getTime())) {
		throw new TypeError(`${label} must be a valid date or null`);
	}
}

function normalizeOptionalText(value: string | null | undefined, label: string): string | null {
	if (value === null || value === undefined) return null;
	assertTrimmed(value, label);
	return value;
}

function sameNullable<T>(left: T | null, right: T | null | undefined): boolean {
	return left === (right ?? null);
}

function slotKey(kind: RevisionKind, season: number | null, episode: number | null): string {
	return `${kind}:${season ?? '-'}:${episode ?? '-'}`;
}

function revisionTargetPredicate(serverInstanceId: string, scope: ArtworkRevisionTimelineScope) {
	return scope.mediaItemId != null
		? and(
				eq(artworkRevisions.serverInstanceId, serverInstanceId),
				eq(artworkRevisions.mediaItemId, scope.mediaItemId),
				isNull(artworkRevisions.mediaCollectionId)
			)
		: and(
				eq(artworkRevisions.serverInstanceId, serverInstanceId),
				isNull(artworkRevisions.mediaItemId),
				eq(artworkRevisions.mediaCollectionId, scope.mediaCollectionId!)
			);
}

function slotTargetPredicate(
	serverInstanceId: string,
	target: {
		mediaItemId?: number | null;
		mediaCollectionId?: string | null;
		kind: RevisionKind;
		season?: number | null;
		episode?: number | null;
	}
) {
	const targetPredicate =
		target.mediaItemId != null
			? and(
					eq(artworkSlotStates.mediaItemId, target.mediaItemId),
					isNull(artworkSlotStates.mediaCollectionId)
				)
			: and(
					isNull(artworkSlotStates.mediaItemId),
					eq(artworkSlotStates.mediaCollectionId, target.mediaCollectionId!)
				);
	return and(
		eq(artworkSlotStates.serverInstanceId, serverInstanceId),
		targetPredicate,
		eq(artworkSlotStates.kind, target.kind),
		target.season == null
			? isNull(artworkSlotStates.season)
			: eq(artworkSlotStates.season, target.season),
		target.episode == null
			? isNull(artworkSlotStates.episode)
			: eq(artworkSlotStates.episode, target.episode)
	);
}

/**
 * Append-only revision persistence. Only the aggregate group and current slot projection
 * are mutable; an inserted artwork revision is never updated or deleted by this API.
 */
export function createArtworkRevisionLedger(
	database: Database,
	options: ArtworkRevisionLedgerOptions = {}
) {
	const clock = options.clock ?? (() => new Date());
	const generateGroupId = options.generateGroupId ?? randomUUID;
	const generateRevisionId = options.generateRevisionId ?? randomUUID;

	async function createGroup(
		input: CreateArtworkRevisionGroupInput
	): Promise<ArtworkRevisionGroup> {
		assertTrimmed(input.serverInstanceId, 'Server instance id');
		assertTrimmed(input.initiator, 'Initiator');
		const operationPlanId = normalizeOptionalText(input.operationPlanId, 'Operation plan id');
		if (input.jobId != null && (!Number.isInteger(input.jobId) || input.jobId <= 0)) {
			throw new TypeError('Job id must be a positive integer');
		}
		const id = generateGroupId();
		assertTrimmed(id, 'Generated revision group id');
		const now = checkedNow(clock);

		return database.transaction(async (tx) => {
			const server = (
				await tx
					.select({ id: serverInstances.id })
					.from(serverInstances)
					.where(eq(serverInstances.id, input.serverInstanceId))
					.limit(1)
			)[0];
			if (!server) {
				throw new ArtworkRevisionLedgerError(
					'revision_target_scope_mismatch',
					input.serverInstanceId
				);
			}

			if (operationPlanId) {
				const plan = (
					await tx
						.select({ id: operationPlans.id, serverInstanceId: operationPlans.serverInstanceId })
						.from(operationPlans)
						.where(eq(operationPlans.id, operationPlanId))
						.limit(1)
				)[0];
				if (!plan) throw new ArtworkRevisionLedgerError('revision_link_not_found', operationPlanId);
				if (plan.serverInstanceId !== null && plan.serverInstanceId !== input.serverInstanceId) {
					throw new ArtworkRevisionLedgerError('revision_link_scope_mismatch', operationPlanId);
				}
			}

			if (input.jobId != null) {
				const job = (
					await tx
						.select({ id: jobs.id, serverInstanceId: jobs.serverInstanceId })
						.from(jobs)
						.where(eq(jobs.id, input.jobId))
						.limit(1)
				)[0];
				if (!job) {
					throw new ArtworkRevisionLedgerError('revision_link_not_found', String(input.jobId));
				}
				if (job.serverInstanceId !== null && job.serverInstanceId !== input.serverInstanceId) {
					throw new ArtworkRevisionLedgerError('revision_link_scope_mismatch', String(input.jobId));
				}
			}

			const [group] = await tx
				.insert(artworkRevisionGroups)
				.values({
					id,
					serverInstanceId: input.serverInstanceId,
					operationPlanId,
					jobId: input.jobId ?? null,
					kind: input.kind,
					initiator: input.initiator,
					outcome: 'pending',
					summary: null,
					createdAt: now,
					completedAt: null
				})
				.returning();
			return group;
		});
	}

	async function recordOutcome(
		input: RecordArtworkRevisionOutcomeInput
	): Promise<RecordedArtworkRevisionOutcome> {
		assertTrimmed(input.groupId, 'Revision group id');
		assertTrimmed(input.serverInstanceId, 'Server instance id');
		assertTarget(input);
		if (input.action === 'undo' && !input.undoOfRevisionId) {
			throw new TypeError('Undo outcomes must link to the revision being reversed');
		}
		if (input.action !== 'undo' && input.undoOfRevisionId) {
			throw new TypeError('Only undo outcomes may link to an earlier revision');
		}
		if (
			input.candidateId != null &&
			(!Number.isInteger(input.candidateId) || input.candidateId <= 0)
		) {
			throw new TypeError('Candidate id must be a positive integer');
		}
		if (input.candidateId != null && input.mediaItemId == null) {
			throw new TypeError('Candidate-backed revisions require a media item target');
		}
		if (
			input.outcome === 'success' &&
			input.verification !== 'exact' &&
			input.verification !== 'best_effort'
		) {
			throw new TypeError('Successful outcomes require exact or best-effort verification');
		}
		if (input.slotState && input.destination !== 'server') {
			throw new TypeError('Only server destinations can update the current slot projection');
		}
		if (
			input.slotState?.artworkVersion !== undefined &&
			(!Number.isInteger(input.slotState.artworkVersion) || input.slotState.artworkVersion < 0)
		) {
			throw new TypeError('Artwork version must be a non-negative integer');
		}
		if (input.slotState?.advanceArtworkVersion && input.slotState.artworkVersion !== undefined) {
			throw new TypeError('Artwork version cannot be explicit and automatically advanced');
		}
		assertOptionalDate(input.slotState?.lastObservedAt, 'Last observed time');
		assertOptionalDate(input.slotState?.lastVerifiedAt, 'Last verified time');
		assertOptionalDate(input.slotState?.externalChangedAt, 'External change time');

		const undoOfRevisionId = normalizeOptionalText(input.undoOfRevisionId, 'Undo revision id');
		const beforeSnapshotId = normalizeOptionalText(input.beforeSnapshotId, 'Before snapshot id');
		const afterSnapshotId = normalizeOptionalText(input.afterSnapshotId, 'After snapshot id');
		const applyMethod = normalizeOptionalText(input.applyMethod, 'Apply method');
		const requestedSourceProvider = normalizeOptionalText(input.sourceProvider, 'Source provider');
		const errorCode = normalizeOptionalText(input.errorCode, 'Error code');
		const safeError = input.error ? redactApplyErrorText(input.error) : null;
		const now = checkedNow(clock);
		const id = generateRevisionId();
		assertTrimmed(id, 'Generated revision id');

		return database.transaction(async (tx) => {
			const group = (
				await tx
					.select()
					.from(artworkRevisionGroups)
					.where(eq(artworkRevisionGroups.id, input.groupId))
					.limit(1)
			)[0];
			if (!group) {
				throw new ArtworkRevisionLedgerError('revision_group_not_found', input.groupId);
			}
			if (group.serverInstanceId !== input.serverInstanceId) {
				throw new ArtworkRevisionLedgerError('revision_group_scope_mismatch', input.groupId);
			}
			if (group.outcome !== 'pending' || group.completedAt !== null) {
				throw new ArtworkRevisionLedgerError('revision_group_completed', input.groupId);
			}
			if (group.kind !== input.action) {
				throw new ArtworkRevisionLedgerError('revision_group_action_mismatch', input.groupId);
			}

			let targetMediaItem: { id: number; artworkVersion: number } | null = null;
			if (input.mediaItemId != null) {
				targetMediaItem =
					(
						await tx
							.select({ id: mediaItems.id, artworkVersion: mediaItems.artworkVersion })
							.from(mediaItems)
							.where(
								and(
									eq(mediaItems.id, input.mediaItemId),
									eq(mediaItems.serverInstanceId, input.serverInstanceId)
								)
							)
							.limit(1)
					)[0] ?? null;
				if (!targetMediaItem) {
					throw new ArtworkRevisionLedgerError(
						'revision_target_scope_mismatch',
						String(input.mediaItemId)
					);
				}
			} else {
				const collection = (
					await tx
						.select({ id: mediaCollections.id })
						.from(mediaCollections)
						.where(
							and(
								eq(mediaCollections.id, input.mediaCollectionId!),
								eq(mediaCollections.serverInstanceId, input.serverInstanceId)
							)
						)
						.limit(1)
				)[0];
				if (!collection) {
					throw new ArtworkRevisionLedgerError(
						'revision_target_scope_mismatch',
						input.mediaCollectionId!
					);
				}
			}

			let candidate: {
				id: number;
				provider: string;
				providerAssetId: string | null;
				setId: string;
				setAuthor: string | null;
				designFamily: string | null;
				language: string | null;
				width: number | null;
				height: number | null;
				score: number | null;
				resolvedTmdbId: string | null;
				resolvedMediaType: 'movie' | 'tv' | null;
			} | null = null;
			if (input.candidateId != null) {
				candidate =
					(
						await tx
							.select({
								id: posterCandidates.id,
								provider: posterCandidates.provider,
								providerAssetId: posterCandidates.providerAssetId,
								setId: posterCandidates.setId,
								setAuthor: posterCandidates.setAuthor,
								designFamily: posterCandidates.designFamily,
								language: posterCandidates.language,
								width: posterCandidates.width,
								height: posterCandidates.height,
								score: posterCandidates.score,
								resolvedTmdbId: posterCandidates.resolvedTmdbId,
								resolvedMediaType: posterCandidates.resolvedMediaType
							})
							.from(posterCandidates)
							.where(
								and(
									eq(posterCandidates.id, input.candidateId),
									eq(posterCandidates.serverInstanceId, input.serverInstanceId),
									input.mediaItemId == null
										? undefined
										: eq(posterCandidates.mediaItemId, input.mediaItemId)
								)
							)
							.limit(1)
					)[0] ?? null;
				if (!candidate) {
					throw new ArtworkRevisionLedgerError(
						'revision_candidate_scope_mismatch',
						String(input.candidateId)
					);
				}
			}

			if (undoOfRevisionId) {
				const original = (
					await tx
						.select()
						.from(artworkRevisions)
						.where(eq(artworkRevisions.id, undoOfRevisionId))
						.limit(1)
				)[0];
				if (!original) {
					throw new ArtworkRevisionLedgerError('revision_undo_target_not_found', undoOfRevisionId);
				}
				const sameScope =
					original.serverInstanceId === input.serverInstanceId &&
					sameNullable(original.mediaItemId, input.mediaItemId) &&
					sameNullable(original.mediaCollectionId, input.mediaCollectionId) &&
					original.destination === input.destination &&
					original.kind === input.kind &&
					sameNullable(original.season, input.season) &&
					sameNullable(original.episode, input.episode);
				if (!sameScope) {
					throw new ArtworkRevisionLedgerError('revision_undo_scope_mismatch', undoOfRevisionId);
				}
			}

			const candidateProvenance = candidate
				? {
						id: candidate.id,
						provider: candidate.provider,
						providerAssetId: candidate.providerAssetId,
						setId: candidate.setId,
						setAuthor: candidate.setAuthor,
						designFamily: candidate.designFamily,
						language: candidate.language,
						width: candidate.width,
						height: candidate.height,
						score: candidate.score,
						resolvedTmdbId: candidate.resolvedTmdbId,
						resolvedMediaType: candidate.resolvedMediaType
					}
				: undefined;
			const provenance =
				input.provenance || candidateProvenance
					? {
							...(input.provenance ?? {}),
							...(candidateProvenance ? { candidate: candidateProvenance } : {})
						}
					: null;

			const [revision] = await tx
				.insert(artworkRevisions)
				.values({
					id,
					groupId: group.id,
					serverInstanceId: input.serverInstanceId,
					mediaItemId: input.mediaItemId ?? null,
					mediaCollectionId: input.mediaCollectionId ?? null,
					operationPlanId: group.operationPlanId,
					jobId: group.jobId,
					undoOfRevisionId,
					beforeSnapshotId,
					afterSnapshotId,
					candidateId: input.candidateId ?? null,
					action: input.action,
					destination: input.destination,
					kind: input.kind,
					season: input.season ?? null,
					episode: input.episode ?? null,
					applyMethod,
					sourceProvider: requestedSourceProvider ?? candidate?.provider ?? null,
					provenance,
					priorFingerprint: input.priorFingerprint ?? null,
					proposedFingerprint: input.proposedFingerprint ?? null,
					outcome: input.outcome,
					verification: input.verification,
					errorCode,
					error: safeError,
					createdAt: now,
					completedAt: now
				})
				.returning();

			let currentSlotState: ArtworkSlotState | null = null;
			if (input.slotState) {
				const safeCurrentUrl = sanitizeServerArtworkUrl(input.slotState.currentUrl);
				const predicate = slotTargetPredicate(input.serverInstanceId, input);
				const existing = (await tx.select().from(artworkSlotStates).where(predicate).limit(1))[0];
				const update = {
					currentUrl: safeCurrentUrl,
					currentFingerprint: input.slotState.currentFingerprint,
					artworkVersion: input.slotState.advanceArtworkVersion
						? (existing?.artworkVersion ?? 0) + 1
						: (input.slotState.artworkVersion ?? existing?.artworkVersion ?? 0),
					lastObservedAt: Object.hasOwn(input.slotState, 'lastObservedAt')
						? (input.slotState.lastObservedAt ?? null)
						: (existing?.lastObservedAt ?? null),
					lastVerifiedAt: Object.hasOwn(input.slotState, 'lastVerifiedAt')
						? (input.slotState.lastVerifiedAt ?? null)
						: (existing?.lastVerifiedAt ?? null),
					externalChangedAt: Object.hasOwn(input.slotState, 'externalChangedAt')
						? (input.slotState.externalChangedAt ?? null)
						: (existing?.externalChangedAt ?? null),
					updatedAt: now
				};
				if (existing) {
					[currentSlotState] = await tx
						.update(artworkSlotStates)
						.set(update)
						.where(eq(artworkSlotStates.id, existing.id))
						.returning();
				} else {
					[currentSlotState] = await tx
						.insert(artworkSlotStates)
						.values({
							serverInstanceId: input.serverInstanceId,
							mediaItemId: input.mediaItemId ?? null,
							mediaCollectionId: input.mediaCollectionId ?? null,
							kind: input.kind,
							season: input.season ?? null,
							episode: input.episode ?? null,
							...update
						})
						.returning();
				}

				if (
					targetMediaItem &&
					input.season == null &&
					input.episode == null &&
					(input.kind === 'poster' || input.kind === 'background')
				) {
					await tx
						.update(mediaItems)
						.set({
							...(input.kind === 'poster'
								? {
										currentPosterUrl: safeCurrentUrl,
										currentPosterFingerprint: input.slotState.currentFingerprint
									}
								: {
										currentBackgroundUrl: safeCurrentUrl,
										currentBackgroundFingerprint: input.slotState.currentFingerprint
									}),
							...(input.slotState.advanceArtworkVersion && input.kind === 'poster'
								? { artworkVersion: targetMediaItem.artworkVersion + 1 }
								: {}),
							...(Object.hasOwn(input.slotState, 'lastVerifiedAt')
								? { lastVerifiedAt: input.slotState.lastVerifiedAt ?? null }
								: {}),
							...(Object.hasOwn(input.slotState, 'externalChangedAt')
								? { externalArtworkChangedAt: input.slotState.externalChangedAt ?? null }
								: {}),
							updatedAt: now
						})
						.where(eq(mediaItems.id, targetMediaItem.id));
				}
			}

			return { revision, currentSlotState };
		});
	}

	async function finalizeGroup(
		input: FinalizeArtworkRevisionGroupInput
	): Promise<ArtworkRevisionGroup> {
		assertTrimmed(input.groupId, 'Revision group id');
		assertTrimmed(input.serverInstanceId, 'Server instance id');
		const now = checkedNow(clock);

		return database.transaction(async (tx) => {
			const group = (
				await tx
					.select()
					.from(artworkRevisionGroups)
					.where(eq(artworkRevisionGroups.id, input.groupId))
					.limit(1)
			)[0];
			if (!group) {
				throw new ArtworkRevisionLedgerError('revision_group_not_found', input.groupId);
			}
			if (group.serverInstanceId !== input.serverInstanceId) {
				throw new ArtworkRevisionLedgerError('revision_group_scope_mismatch', input.groupId);
			}
			if (group.outcome !== 'pending' || group.completedAt !== null) {
				throw new ArtworkRevisionLedgerError('revision_group_completed', input.groupId);
			}

			const rows = await tx
				.select({ outcome: artworkRevisions.outcome, verification: artworkRevisions.verification })
				.from(artworkRevisions)
				.where(
					and(
						eq(artworkRevisions.groupId, input.groupId),
						eq(artworkRevisions.serverInstanceId, input.serverInstanceId)
					)
				);
			if (rows.length === 0) {
				throw new ArtworkRevisionLedgerError('revision_group_empty', input.groupId);
			}
			if (rows.some((row) => row.outcome === 'pending' || row.verification === 'pending')) {
				throw new ArtworkRevisionLedgerError('revision_group_has_pending_outcomes', input.groupId);
			}

			const outcomes = { success: 0, failed: 0, skipped: 0 };
			const verification = {
				exact: 0,
				bestEffort: 0,
				unavailable: 0,
				mismatch: 0,
				failed: 0
			};
			for (const row of rows) {
				if (row.outcome !== 'pending') outcomes[row.outcome] += 1;
				switch (row.verification) {
					case 'exact':
						verification.exact += 1;
						break;
					case 'best_effort':
						verification.bestEffort += 1;
						break;
					case 'unavailable':
						verification.unavailable += 1;
						break;
					case 'mismatch':
						verification.mismatch += 1;
						break;
					case 'failed':
						verification.failed += 1;
						break;
				}
			}
			const outcome: ArtworkRevisionGroup['outcome'] =
				outcomes.failed === 0 && outcomes.skipped === 0
					? 'success'
					: outcomes.success === 0
						? 'failed'
						: 'partial';
			const summary = {
				...(input.summary ?? {}),
				revisionCount: rows.length,
				outcomes,
				verification
			};
			const [completed] = await tx
				.update(artworkRevisionGroups)
				.set({ outcome, summary, completedAt: now })
				.where(
					and(
						eq(artworkRevisionGroups.id, input.groupId),
						eq(artworkRevisionGroups.serverInstanceId, input.serverInstanceId),
						eq(artworkRevisionGroups.outcome, 'pending'),
						isNull(artworkRevisionGroups.completedAt)
					)
				)
				.returning();
			if (!completed) {
				throw new ArtworkRevisionLedgerError('revision_group_completed', input.groupId);
			}
			return completed;
		});
	}

	async function listTimeline(
		scope: ArtworkRevisionTimelineScope
	): Promise<ArtworkRevisionTimelineEntry[]> {
		assertTrimmed(scope.serverInstanceId, 'Server instance id');
		assertTarget(scope);
		const limit = scope.limit ?? 100;
		if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
			throw new RangeError('Timeline limit must be an integer between 1 and 200');
		}
		const rows = await database
			.select({ group: artworkRevisionGroups, revision: artworkRevisions })
			.from(artworkRevisions)
			.innerJoin(artworkRevisionGroups, eq(artworkRevisionGroups.id, artworkRevisions.groupId))
			.where(
				and(
					revisionTargetPredicate(scope.serverInstanceId, scope),
					eq(artworkRevisionGroups.serverInstanceId, scope.serverInstanceId)
				)
			)
			.orderBy(asc(artworkRevisions.createdAt), asc(artworkRevisions.id))
			.limit(limit);

		const states = await database
			.select()
			.from(artworkSlotStates)
			.where(
				scope.mediaItemId != null
					? and(
							eq(artworkSlotStates.serverInstanceId, scope.serverInstanceId),
							eq(artworkSlotStates.mediaItemId, scope.mediaItemId),
							isNull(artworkSlotStates.mediaCollectionId)
						)
					: and(
							eq(artworkSlotStates.serverInstanceId, scope.serverInstanceId),
							isNull(artworkSlotStates.mediaItemId),
							eq(artworkSlotStates.mediaCollectionId, scope.mediaCollectionId!)
						)
			);
		const stateBySlot = new Map(
			states.map((state) => [slotKey(state.kind, state.season, state.episode), state])
		);
		return rows.map(({ group, revision }) => ({
			group,
			revision,
			currentSlotState:
				revision.destination === 'server'
					? (stateBySlot.get(slotKey(revision.kind, revision.season, revision.episode)) ?? null)
					: null
		}));
	}

	return { createGroup, recordOutcome, finalizeGroup, listTimeline };
}

export type ArtworkRevisionLedger = ReturnType<typeof createArtworkRevisionLedger>;
