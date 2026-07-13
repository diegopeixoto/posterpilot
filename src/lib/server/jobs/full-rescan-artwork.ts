import { createHash } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import { artworkSlotStates, mediaItems } from '$lib/server/db/schema';
import type { MediaServer, ServerArtworkKind } from '$lib/server/media-server';
import {
	createArtworkRevisionLedger,
	type ArtworkRevisionLedger
} from '$lib/server/artwork-revisions/ledger';
import { redactSensitiveArtworkUrl } from '$lib/server/plans/apply-redaction';
import { sha256Bytes } from '$lib/server/revisions/verification';
import { sanitizeServerArtworkUrl } from '$lib/server/media-server/artwork-url';

type Database = LibSQLDatabase<typeof schema>;
export type RootArtworkKind = Extract<ServerArtworkKind, 'poster' | 'background'>;

export interface PreviousRootArtwork {
	currentPosterUrl: string | null;
	currentBackgroundUrl: string | null;
	currentPosterFingerprint: string | null;
	currentBackgroundFingerprint: string | null;
	lastVerifiedAt: Date | null;
	externalArtworkChangedAt: Date | null;
}

export interface FullRescanArtworkObservation {
	kind: RootArtworkKind;
	url: string | null;
	fingerprint: string | null;
	evidence: 'bytes' | 'provider_absence' | 'url_identity';
}

export interface TrackedArtworkSlot {
	kind: RootArtworkKind;
	currentUrl: string | null;
	currentFingerprint: string | null;
	lastVerifiedAt: Date | null;
	externalChangedAt: Date | null;
}

export interface FullRescanArtworkStateRepository {
	loadRootSlots(serverInstanceId: string, mediaItemId: number): Promise<TrackedArtworkSlot[]>;
	updateProjection(input: {
		serverInstanceId: string;
		mediaItemId: number;
		kind: RootArtworkKind;
		currentUrl: string | null;
		currentFingerprint: string | null;
		observedAt: Date;
	}): Promise<void>;
}

export interface ObserveFullRescanArtworkInput {
	server: Pick<MediaServer, 'type' | 'readArtwork'>;
	serverInstanceId: string;
	mediaItemId: number;
	sourceItemId: string;
	currentPosterUrl: string | null;
	currentBackgroundUrl: string | null;
	previous: PreviousRootArtwork | null;
	jobId?: number | null;
}

export interface FullRescanArtworkObservationResult {
	observedSlots: number;
	externalChanges: number;
	fallbackReads: number;
}

export interface FullRescanArtworkObserverOptions {
	clock?: () => Date;
	ledger?: Pick<ArtworkRevisionLedger, 'createGroup' | 'recordOutcome' | 'finalizeGroup'>;
}

interface ClassifiedObservation {
	status: 'baseline' | 'unchanged' | 'external_change';
	verification: 'exact' | 'best_effort';
	projectionFingerprint: string | null;
}

const ROOT_KINDS = ['poster', 'background'] as const;

function assertDate(value: Date, label: string): void {
	if (!Number.isFinite(value.getTime())) throw new TypeError(`${label} must be a valid date`);
}

function canonicalUrlIdentity(value: string | null): string | null {
	if (!value) return null;
	const redacted = redactSensitiveArtworkUrl(value);
	if (!redacted) return null;
	try {
		const url = new URL(redacted);
		url.hash = '';
		url.searchParams.sort();
		return url.toString();
	} catch {
		return redacted.trim() || null;
	}
}

/** Stable artwork URL identity that cannot disclose embedded media-server credentials. */
export function fingerprintArtworkUrl(value: string | null): string | null {
	const identity = canonicalUrlIdentity(value);
	return identity === null ? null : `url:${createHash('sha256').update(identity).digest('hex')}`;
}

function previousFromItem(
	kind: RootArtworkKind,
	previous: PreviousRootArtwork | null
): TrackedArtworkSlot | null {
	if (!previous) return null;
	return {
		kind,
		currentUrl: kind === 'poster' ? previous.currentPosterUrl : previous.currentBackgroundUrl,
		currentFingerprint:
			kind === 'poster' ? previous.currentPosterFingerprint : previous.currentBackgroundFingerprint,
		lastVerifiedAt: previous.lastVerifiedAt,
		externalChangedAt: previous.externalArtworkChangedAt
	};
}

/**
 * Decide whether a fresh server observation differs from a trusted prior state.
 * Byte reads are exact; URL-only fallback compares redacted identities so a rotated
 * token cannot create a false external-change review item.
 */
export function classifyFullRescanArtworkObservation(
	previous: TrackedArtworkSlot | null,
	observed: FullRescanArtworkObservation
): ClassifiedObservation {
	if (!previous) {
		return {
			status: 'baseline',
			verification: observed.evidence === 'url_identity' ? 'best_effort' : 'exact',
			projectionFingerprint: observed.fingerprint
		};
	}

	const trusted = previous.lastVerifiedAt !== null || previous.externalChangedAt !== null;
	let changed: boolean;
	let verification: 'exact' | 'best_effort' =
		observed.evidence === 'url_identity' ? 'best_effort' : 'exact';

	if (
		observed.evidence === 'bytes' &&
		previous.currentFingerprint !== null &&
		!previous.currentFingerprint.startsWith('url:')
	) {
		changed = observed.fingerprint !== previous.currentFingerprint;
	} else if (observed.evidence === 'provider_absence') {
		changed = previous.currentFingerprint !== null || previous.currentUrl !== null;
	} else {
		const beforeUrl = canonicalUrlIdentity(previous.currentUrl);
		const afterUrl = canonicalUrlIdentity(observed.url);
		changed = beforeUrl !== afterUrl;
		verification = 'best_effort';
	}

	const external = trusted && changed;
	return {
		status: external ? 'external_change' : trusted ? 'unchanged' : 'baseline',
		verification,
		// A failed exact read must not replace a byte fingerprint with a weaker URL
		// identity while the URL itself is unchanged.
		projectionFingerprint:
			observed.evidence === 'url_identity' && !changed && previous.currentFingerprint !== null
				? previous.currentFingerprint
				: observed.fingerprint
	};
}

async function observeKind(
	server: Pick<MediaServer, 'readArtwork'>,
	sourceItemId: string,
	kind: RootArtworkKind,
	fallbackUrl: string | null
): Promise<FullRescanArtworkObservation> {
	if (server.readArtwork) {
		try {
			const artwork = await server.readArtwork(sourceItemId, kind);
			if (artwork === null) {
				return { kind, url: null, fingerprint: null, evidence: 'provider_absence' };
			}
			if (artwork.data.byteLength > 0) {
				return {
					kind,
					url: sanitizeServerArtworkUrl(artwork.url ?? fallbackUrl),
					fingerprint: sha256Bytes(artwork.data),
					evidence: 'bytes'
				};
			}
		} catch {
			// A full rescan remains useful when exact image retrieval is temporarily
			// unavailable; the provider-native list URL is weaker but still bounded.
		}
	}
	return {
		kind,
		url: sanitizeServerArtworkUrl(fallbackUrl),
		fingerprint: fingerprintArtworkUrl(fallbackUrl),
		evidence: 'url_identity'
	};
}

/** Read poster/background independently so one unavailable slot cannot hide the other. */
export async function readFullRescanArtworkObservations(
	server: Pick<MediaServer, 'readArtwork'>,
	sourceItemId: string,
	current: { poster: string | null; background: string | null }
): Promise<FullRescanArtworkObservation[]> {
	return Promise.all([
		observeKind(server, sourceItemId, 'poster', current.poster),
		observeKind(server, sourceItemId, 'background', current.background)
	]);
}

export function createFullRescanArtworkObserver(
	repository: FullRescanArtworkStateRepository,
	options: FullRescanArtworkObserverOptions
) {
	const ledger = options.ledger;
	if (!ledger) throw new TypeError('A revision ledger is required');
	const clock = options.clock ?? (() => new Date());

	return async function observe(
		input: ObserveFullRescanArtworkInput
	): Promise<FullRescanArtworkObservationResult> {
		if (!input.serverInstanceId.trim()) throw new TypeError('Server instance id is required');
		if (!Number.isSafeInteger(input.mediaItemId) || input.mediaItemId <= 0) {
			throw new TypeError('Media item id must be positive');
		}
		if (!input.sourceItemId.trim()) throw new TypeError('Source item id is required');
		const observedAt = clock();
		assertDate(observedAt, 'Observation time');
		const [states, observations] = await Promise.all([
			repository.loadRootSlots(input.serverInstanceId, input.mediaItemId),
			readFullRescanArtworkObservations(input.server, input.sourceItemId, {
				poster: input.currentPosterUrl,
				background: input.currentBackgroundUrl
			})
		]);
		const stateByKind = new Map(states.map((state) => [state.kind, state]));
		const classified = observations.map((observation) => {
			const prior =
				stateByKind.get(observation.kind) ?? previousFromItem(observation.kind, input.previous);
			return {
				observation,
				prior,
				decision: classifyFullRescanArtworkObservation(prior, observation)
			};
		});
		const external = classified.filter((entry) => entry.decision.status === 'external_change');
		let groupId: string | null = null;
		if (external.length) {
			const group = await ledger.createGroup({
				serverInstanceId: input.serverInstanceId,
				jobId: input.jobId ?? null,
				kind: 'external_observation',
				initiator: 'full_rescan'
			});
			groupId = group.id;
		}

		for (const entry of classified) {
			if (entry.decision.status === 'external_change') {
				await ledger.recordOutcome({
					groupId: groupId!,
					serverInstanceId: input.serverInstanceId,
					mediaItemId: input.mediaItemId,
					action: 'external_observation',
					destination: 'server',
					kind: entry.observation.kind,
					applyMethod: null,
					provenance: {
						trigger: 'full_rescan',
						mediaServerType: input.server.type,
						evidence: entry.observation.evidence
					},
					priorFingerprint:
						entry.prior?.currentFingerprint ??
						fingerprintArtworkUrl(entry.prior?.currentUrl ?? null),
					proposedFingerprint: entry.observation.fingerprint,
					outcome: 'success',
					verification: entry.decision.verification,
					slotState: {
						currentUrl: entry.observation.url,
						currentFingerprint: entry.decision.projectionFingerprint,
						advanceArtworkVersion: true,
						lastObservedAt: observedAt,
						externalChangedAt: observedAt
					}
				});
			} else {
				await repository.updateProjection({
					serverInstanceId: input.serverInstanceId,
					mediaItemId: input.mediaItemId,
					kind: entry.observation.kind,
					currentUrl: entry.observation.url,
					currentFingerprint: entry.decision.projectionFingerprint,
					observedAt
				});
			}
		}

		if (groupId) {
			await ledger.finalizeGroup({
				groupId,
				serverInstanceId: input.serverInstanceId,
				summary: {
					trigger: 'full_rescan',
					externalChanges: external.length,
					observedSlots: observations.length
				}
			});
		}

		return {
			observedSlots: observations.length,
			externalChanges: external.length,
			fallbackReads: observations.filter((entry) => entry.evidence === 'url_identity').length
		};
	};
}

export function createDatabaseFullRescanArtworkObserver(
	database: Database,
	options: Omit<FullRescanArtworkObserverOptions, 'ledger'> & {
		ledger?: Pick<ArtworkRevisionLedger, 'createGroup' | 'recordOutcome' | 'finalizeGroup'>;
	} = {}
) {
	const repository: FullRescanArtworkStateRepository = {
		async loadRootSlots(serverInstanceId, mediaItemId) {
			const rows = await database
				.select({
					kind: artworkSlotStates.kind,
					currentUrl: artworkSlotStates.currentUrl,
					currentFingerprint: artworkSlotStates.currentFingerprint,
					lastVerifiedAt: artworkSlotStates.lastVerifiedAt,
					externalChangedAt: artworkSlotStates.externalChangedAt
				})
				.from(artworkSlotStates)
				.where(
					and(
						eq(artworkSlotStates.serverInstanceId, serverInstanceId),
						eq(artworkSlotStates.mediaItemId, mediaItemId),
						isNull(artworkSlotStates.mediaCollectionId),
						inArray(artworkSlotStates.kind, [...ROOT_KINDS]),
						isNull(artworkSlotStates.season),
						isNull(artworkSlotStates.episode)
					)
				);
			return rows.map((row) => ({ ...row, kind: row.kind as RootArtworkKind }));
		},
		async updateProjection(input) {
			await database.transaction(async (tx) => {
				const [existing] = await tx
					.select({ id: artworkSlotStates.id })
					.from(artworkSlotStates)
					.where(
						and(
							eq(artworkSlotStates.serverInstanceId, input.serverInstanceId),
							eq(artworkSlotStates.mediaItemId, input.mediaItemId),
							isNull(artworkSlotStates.mediaCollectionId),
							eq(artworkSlotStates.kind, input.kind),
							isNull(artworkSlotStates.season),
							isNull(artworkSlotStates.episode)
						)
					)
					.limit(1);
				const values = {
					currentUrl: input.currentUrl,
					currentFingerprint: input.currentFingerprint,
					lastObservedAt: input.observedAt,
					updatedAt: input.observedAt
				};
				if (existing) {
					await tx
						.update(artworkSlotStates)
						.set(values)
						.where(eq(artworkSlotStates.id, existing.id));
				} else {
					await tx.insert(artworkSlotStates).values({
						serverInstanceId: input.serverInstanceId,
						mediaItemId: input.mediaItemId,
						mediaCollectionId: null,
						kind: input.kind,
						season: null,
						episode: null,
						...values
					});
				}
				await tx
					.update(mediaItems)
					.set({
						...(input.kind === 'poster'
							? {
									currentPosterUrl: input.currentUrl,
									currentPosterFingerprint: input.currentFingerprint
								}
							: {
									currentBackgroundUrl: input.currentUrl,
									currentBackgroundFingerprint: input.currentFingerprint
								}),
						updatedAt: input.observedAt
					})
					.where(
						and(
							eq(mediaItems.serverInstanceId, input.serverInstanceId),
							eq(mediaItems.id, input.mediaItemId)
						)
					);
			});
		}
	};
	return createFullRescanArtworkObserver(repository, {
		clock: options.clock,
		ledger: options.ledger ?? createArtworkRevisionLedger(database)
	});
}
