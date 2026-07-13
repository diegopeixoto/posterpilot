import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { clearEvents, listEvents, type EventLevelFilter } from '$lib/server/queries';
import { logEvent } from '$lib/server/events';
import { getActiveServerInstance } from '$lib/server/server-instances';

const PAGE_SIZE = 50;
const LEVELS: EventLevelFilter[] = ['info', 'warn', 'error'];

/** Page the activity log for the Settings → Activity tab (filter + id cursor). */
export const GET: RequestHandler = async ({ url }) => {
	const active = await getActiveServerInstance();
	if (!active) return json({ events: [], nextCursor: null });
	const levelParam = url.searchParams.get('level');
	const level = LEVELS.includes(levelParam as EventLevelFilter)
		? (levelParam as EventLevelFilter)
		: undefined;
	const beforeParam = Number(url.searchParams.get('before'));
	const before = Number.isFinite(beforeParam) && beforeParam > 0 ? beforeParam : undefined;

	// Fetch one extra row to know whether a "load more" page exists.
	const rows = await listEvents({
		serverInstanceId: active.id,
		level,
		before,
		limit: PAGE_SIZE + 1
	});
	const hasMore = rows.length > PAGE_SIZE;
	const events = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
	const nextCursor = hasMore ? events[events.length - 1].id : null;

	return json({ events, nextCursor });
};

/** Clear the entire activity log (Settings → Activity → "Clear activity"). */
export const DELETE: RequestHandler = async () => {
	const active = await getActiveServerInstance();
	if (!active) return json({ error: { code: 'server_instance_not_found' } }, { status: 409 });
	await clearEvents(active.id);
	// Leave a single breadcrumb so the cleared log is self-documenting.
	await logEvent('info', 'system', 'Activity log cleared', {
		serverInstanceId: active.id
	});
	return json({ ok: true });
};
