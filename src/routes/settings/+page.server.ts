import type { PageServerLoad } from './$types';
import {
	getAuthState,
	getArtworkRankingSettings,
	getCachedLibraries,
	isAuthModeEnvManaged,
	publicConfig
} from '$lib/server/config';
import { listEvents } from '$lib/server/queries';
import { getDiagnostics } from '$lib/server/diagnostics';
import { getActiveServerInstance, listManagedServers } from '$lib/server/server-instances';
import {
	listApplicationBackups,
	listApplicationRestoreHistory,
	readApplicationBackupRetentionPolicy
} from '$lib/server/backups';
import { automationStore } from '$lib/server/automation/runtime';
import { listReviewViews } from '$lib/server/review';

const EVENTS_PAGE_SIZE = 50;

export const load: PageServerLoad = async () => {
	const active = await getActiveServerInstance();
	// These reads are independent — run them concurrently. The cached library list
	// renders instantly (no network); a client Refresh re-fetches the live list.
	const [
		cached,
		auth,
		config,
		diagnostics,
		serverManagement,
		ranking,
		automations,
		automationHistory,
		automationReviewViews
	] = await Promise.all([
		active ? getCachedLibraries(active.id) : Promise.resolve([]),
		// Auth summary for the Security tab — never expose the password hash.
		getAuthState(),
		publicConfig(active?.id),
		getDiagnostics(undefined, 5),
		listManagedServers(),
		getArtworkRankingSettings(),
		active ? automationStore.list(active.id) : Promise.resolve([]),
		active ? automationStore.history(active.id, 50) : Promise.resolve([]),
		active ? listReviewViews(active.id) : Promise.resolve([])
	]);
	const rows = serverManagement.activeServerId
		? await listEvents({
				serverInstanceId: serverManagement.activeServerId,
				limit: EVENTS_PAGE_SIZE + 1
			})
		: [];
	const sections = cached.map((l) => ({ key: l.key, title: l.title, type: l.type }));

	const hasMore = rows.length > EVENTS_PAGE_SIZE;
	const events = hasMore ? rows.slice(0, EVENTS_PAGE_SIZE) : rows;
	const eventsNextCursor = hasMore ? events[events.length - 1].id : null;
	// Backup reconciliation can update inventory rows, so keep it outside the broad
	// read-only Promise.all above to avoid embedded-SQLite transaction contention.
	const backups = await listApplicationBackups();
	const backupPolicy = await readApplicationBackupRetentionPolicy();
	const restoreHistory = await listApplicationRestoreHistory();

	return {
		config,
		ranking,
		diagnostics,
		servers: serverManagement.servers,
		serverManagement,
		backups,
		backupPolicy,
		restoreHistory,
		automations,
		automationHistory,
		automationReviewViews: automationReviewViews.map((view) => ({ id: view.id, name: view.name })),
		sections,
		events,
		eventsNextCursor,
		auth: {
			storedMode: auth.storedMode,
			username: auth.username,
			hasPassword: !!auth.passwordHash,
			envManaged: isAuthModeEnvManaged()
		}
	};
};
