import { randomUUID } from 'node:crypto';
import type { PageServerLoad } from './$types';
import { listPosterMatchCandidates, listPosterMatchEligibleItems } from '$lib/server/queries';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const load: PageServerLoad = async ({ url }) => {
	const active = await getActiveServerInstance();
	const items = active ? await listPosterMatchEligibleItems(active.id) : [];
	const requestedId = Number(url.searchParams.get('item'));
	const selectedItem = Number.isSafeInteger(requestedId)
		? (items.find((item) => item.id === requestedId) ?? null)
		: null;
	const candidates =
		selectedItem && active ? await listPosterMatchCandidates(selectedItem.id, active.id) : [];
	const rawSeed = url.searchParams.get('seed');
	const seed = rawSeed && /^[A-Za-z0-9_-]{1,64}$/.test(rawSeed) ? rawSeed : randomUUID();
	return { items, selectedItem, candidates, seed };
};
