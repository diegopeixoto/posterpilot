import type { PageServerLoad } from './$types';
import {
	getAuthState,
	getCachedLibraries,
	isAuthModeEnvManaged,
	publicConfig
} from '$lib/server/config';
import { listEvents } from '$lib/server/queries';

const EVENTS_PAGE_SIZE = 50;

export const load: PageServerLoad = async () => {
	// These reads are independent — run them concurrently. The cached library list
	// renders instantly (no network); a client Refresh re-fetches the live list.
	const [cached, rows, auth, config] = await Promise.all([
		getCachedLibraries(),
		// First page of the activity log for the Activity tab (one extra row = has-more).
		listEvents({ limit: EVENTS_PAGE_SIZE + 1 }),
		// Auth summary for the Security tab — never expose the password hash.
		getAuthState(),
		publicConfig()
	]);
	const sections = cached.map((l) => ({ key: l.key, title: l.title, type: l.type }));

	const hasMore = rows.length > EVENTS_PAGE_SIZE;
	const events = hasMore ? rows.slice(0, EVENTS_PAGE_SIZE) : rows;
	const eventsNextCursor = hasMore ? events[events.length - 1].id : null;

	return {
		config,
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
