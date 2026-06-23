import type { PageServerLoad } from './$types';
import { listEvents, type EventLevelFilter } from '$lib/server/queries';

const PAGE_SIZE = 50;
const LEVELS: EventLevelFilter[] = ['info', 'warn', 'error'];

export const load: PageServerLoad = async ({ url }) => {
	const levelParam = url.searchParams.get('level');
	const level = LEVELS.includes(levelParam as EventLevelFilter)
		? (levelParam as EventLevelFilter)
		: undefined;
	const beforeParam = Number(url.searchParams.get('before'));
	const before = Number.isFinite(beforeParam) && beforeParam > 0 ? beforeParam : undefined;

	// Fetch one extra row to know whether a "load more" page exists.
	const rows = await listEvents({ level, before, limit: PAGE_SIZE + 1 });
	const hasMore = rows.length > PAGE_SIZE;
	const events = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
	const nextCursor = hasMore ? events[events.length - 1].id : null;

	return { events, level: level ?? 'all', nextCursor };
};
