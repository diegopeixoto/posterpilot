import type { PageServerLoad } from './$types';
import { getCachedLibraries, publicConfig } from '$lib/server/config';
import { listEvents } from '$lib/server/queries';

const EVENTS_PAGE_SIZE = 50;

export const load: PageServerLoad = async () => {
	// Render the cached library list instantly (no network). A client-side Refresh
	// button re-fetches the live list and updates the cache.
	const cached = await getCachedLibraries();
	const sections = cached.map((l) => ({ key: l.key, title: l.title, type: l.type }));

	// First page of the activity log for the Activity tab.
	const rows = await listEvents({ limit: EVENTS_PAGE_SIZE + 1 });
	const hasMore = rows.length > EVENTS_PAGE_SIZE;
	const events = hasMore ? rows.slice(0, EVENTS_PAGE_SIZE) : rows;
	const eventsNextCursor = hasMore ? events[events.length - 1].id : null;

	return { config: await publicConfig(), sections, events, eventsNextCursor };
};
