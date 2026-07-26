import { env } from '$env/dynamic/private';
import { createArtworkRevisionLedger } from '$lib/server/artwork-revisions/ledger';
import { createArtworkUndoExecutor } from '$lib/server/artwork-revisions/undo-executor';
import {
	ArtworkSnapshotStore,
	resolveArtworkSnapshotDirectory
} from '$lib/server/artwork-revisions/snapshot-store';
import { createArtworkSnapshotRepository } from '$lib/server/artwork-revisions/snapshots';
import { resolveConfig } from '$lib/server/config';
import { resolveDataPaths } from '$lib/server/data-paths';
import { db } from '$lib/server/db';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { logEvent } from '$lib/server/events';
import { getScoreWeights } from '$lib/server/posters/score-weights';
import { createDatabaseApplyServerRegistry } from '$lib/server/plans/apply-server-registry';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import {
	createNativeCollectionArtworkService,
	NativeCollectionArtworkServiceError,
	type ConfirmNativeCollectionArtworkInput,
	type PreviewNativeCollectionArtworkInput
} from './native-artwork-service';
import { loadNativeCollectionArtworkContext } from './native-artwork-context';
import type { NativeCollectionArtworkCandidate } from './native-artwork-candidates';
import {
	fetchNativeCollectionCandidateBytes,
	fetchThePosterDbNativeCollectionArtworkCandidates,
	fetchTmdbNativeCollectionArtworkCandidates
} from './native-artwork-source';
import {
	createNativeCollectionUndo,
	type ConfirmNativeCollectionUndoInput,
	type PreviewNativeCollectionUndoInput
} from './native-artwork-undo';
import { createNativeCollectionArtworkHistory } from './native-artwork-history';

interface NativeArtworkRuntime {
	service: ReturnType<typeof createNativeCollectionArtworkService>;
	undo: ReturnType<typeof createNativeCollectionUndo>;
}

let liveRuntime: NativeArtworkRuntime | null = null;

function runtime(): NativeArtworkRuntime {
	if (liveRuntime) return liveRuntime;
	const serverRegistry = createDatabaseApplyServerRegistry();
	const snapshotStore = new ArtworkSnapshotStore(
		resolveArtworkSnapshotDirectory(resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE))
	);
	const snapshots = createArtworkSnapshotRepository(db, snapshotStore);
	const ledger = createArtworkRevisionLedger(db);
	const service = createNativeCollectionArtworkService({
		database: db,
		serverRegistry,
		planStore: operationPlanStore,
		snapshots,
		ledger,
		async loadCandidates(tmdbCollectionId, collectionName) {
			const [config, weights] = await Promise.all([resolveConfig(), getScoreWeights()]);
			if (!config.providerTmdb || !config.tmdbKey) {
				throw new Error('native_collection_tmdb_unavailable');
			}
			const tmdbCandidates = await fetchTmdbNativeCollectionArtworkCandidates(
				tmdbCollectionId,
				config.tmdbKey,
				weights
			);
			// Best-effort: ThePosterDB has no collection-id mapping (title-search only), so a
			// search miss, auth failure, or markup mismatch here must never take down the
			// TMDB candidates this runs alongside. Runs whenever the provider is enabled —
			// account credentials only upgrade the scrape to an authenticated session.
			let thePosterDbCandidates: NativeCollectionArtworkCandidate[] = [];
			if (config.providerThePosterDb) {
				try {
					thePosterDbCandidates = await fetchThePosterDbNativeCollectionArtworkCandidates(
						collectionName,
						tmdbCollectionId,
						weights,
						config
					);
					await logEvent(
						'info',
						'native_collection_discover',
						`ThePosterDB collection search for "${collectionName}" found ${thePosterDbCandidates.length} candidate(s)`,
						{ collectionName, tmdbCollectionId }
					);
				} catch (err) {
					thePosterDbCandidates = [];
					await logEvent(
						'warn',
						'native_collection_discover',
						`ThePosterDB collection search failed for "${collectionName}"`,
						{
							collectionName,
							tmdbCollectionId,
							error: err instanceof Error ? err.message : String(err)
						}
					);
				}
			}
			// Combine and re-sort by score so a strong ThePosterDB match isn't buried
			// at the end of the (horizontally scrolling) candidate row behind TMDB's.
			return [...tmdbCandidates, ...thePosterDbCandidates].sort(
				(left, right) => right.score - left.score
			);
		},
		loadCandidateBytes: fetchNativeCollectionCandidateBytes
	});
	const plannerDependencies = {
		database: db,
		serverRegistry,
		readKometa: async () => undefined,
		planStore: operationPlanStore
	};
	const undo = createNativeCollectionUndo({
		plannerDependencies,
		executor: createArtworkUndoExecutor({
			serverRegistry,
			snapshots,
			ledger,
			readKometa: async () => undefined,
			mutateKometa: async () => {
				throw new Error('native_collection_kometa_unsupported');
			}
		}),
		planStore: operationPlanStore,
		async assertCollection(serverInstanceId, mediaCollectionId) {
			const context = await loadNativeCollectionArtworkContext(
				db,
				serverInstanceId,
				mediaCollectionId
			);
			if (context.source !== 'native' || !context.nativeProvider) {
				throw new NativeCollectionArtworkServiceError('native_collection_unavailable');
			}
		},
		mutationsAllowed: assertMutationsAllowed
	});
	liveRuntime = { service, undo };
	return liveRuntime;
}

export function getNativeCollectionArtworkWorkspace(
	serverInstanceId: string,
	mediaCollectionId: string
) {
	return runtime().service.getWorkspace(serverInstanceId, mediaCollectionId);
}

export function previewNativeCollectionArtwork(input: PreviewNativeCollectionArtworkInput) {
	return runtime().service.preview(input);
}

export function confirmNativeCollectionArtwork(input: ConfirmNativeCollectionArtworkInput) {
	return runtime().service.confirm(input);
}

export function readNativeCollectionCurrentArtwork(
	serverInstanceId: string,
	mediaCollectionId: string,
	kind: 'poster' | 'background'
) {
	return runtime().service.readCurrent(serverInstanceId, mediaCollectionId, kind);
}

export function getNativeCollectionCandidatePreviewSource(
	serverInstanceId: string,
	mediaCollectionId: string,
	candidateId: string
) {
	return runtime().service.candidatePreviewSource(serverInstanceId, mediaCollectionId, candidateId);
}

export function previewNativeCollectionArtworkUndo(input: PreviewNativeCollectionUndoInput) {
	return runtime().undo.preview(input);
}

export async function confirmNativeCollectionArtworkUndo(input: ConfirmNativeCollectionUndoInput) {
	const active = runtime();
	const result = await active.undo.confirm(input);
	await active.service
		.refreshProjection(input.serverInstanceId, input.mediaCollectionId)
		.catch(() => undefined);
	return result;
}

export function listNativeCollectionArtworkHistory(
	serverInstanceId: string,
	mediaCollectionId: string,
	limit = 50
) {
	return createNativeCollectionArtworkHistory(db)(serverInstanceId, mediaCollectionId, limit);
}
