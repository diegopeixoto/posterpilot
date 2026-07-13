import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { resolveDataPaths } from '$lib/server/data-paths';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { operationPlanStore } from '$lib/server/plans/operation-plan-store';
import {
	ArtworkSnapshotStore,
	resolveArtworkSnapshotDirectory
} from '$lib/server/artwork-revisions/snapshot-store';
import { createServerPurgeService, type ConfirmServerPurgeInput } from './purge';

let service: ReturnType<typeof createServerPurgeService> | null = null;

function liveService() {
	if (service) return service;
	const snapshotStore = new ArtworkSnapshotStore(
		resolveArtworkSnapshotDirectory(resolveDataPaths(env.DATABASE_URL, env.APP_KEY_FILE))
	);
	service = createServerPurgeService(db, operationPlanStore, { snapshotStore });
	return service;
}

export function previewServerPurge(serverInstanceId: string) {
	assertMutationsAllowed();
	return liveService().preview(serverInstanceId);
}

export function confirmServerPurge(input: ConfirmServerPurgeInput) {
	assertMutationsAllowed();
	return liveService().confirm(input);
}
