import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canonicalFunActiveUrl } from '$lib/fun-active-context';
import { validatePickFilter } from '$lib/server/fun-pick';
import { planDurationSession } from '$lib/server/fun-session';
import {
	countFunEligible,
	listFunEligibleItems,
	listFunLibraries,
	listGenres
} from '$lib/server/queries';
import { getActiveServerInstance } from '$lib/server/server-instances';

export const load: PageServerLoad = async ({ url }) => {
	const active = await getActiveServerInstance();
	const libraries = active ? await listFunLibraries(active.id) : [];
	const canonicalScope = canonicalFunActiveUrl(
		url,
		new Set(libraries.map((library) => library.key))
	);
	if (canonicalScope) throw redirect(303, canonicalScope);

	const parsed = validatePickFilter(url.searchParams);
	const budgetRaw = Number(url.searchParams.get('budget') ?? 240);
	const budgetMinutes = Number.isInteger(budgetRaw) ? budgetRaw : 0;
	const filmCount = url.searchParams.get('films') === '3' ? 3 : 2;
	const planning = url.searchParams.has('plan');
	const rawSeed = url.searchParams.get('plan');
	const seed = rawSeed && /^[A-Za-z0-9_-]{1,64}$/.test(rawSeed) ? rawSeed : randomUUID();
	const filter = {
		...parsed.filter,
		serverInstanceId: active?.id ?? '__no_active_server__',
		type: 'movie' as const,
		count: 3 as const,
		seed
	};

	const hasErrors = Object.keys(parsed.errors).length > 0;
	const [genres, eligibleCount, candidates] = await Promise.all([
		filter.serverInstanceId ? listGenres(filter.serverInstanceId) : Promise.resolve([]),
		hasErrors ? Promise.resolve(0) : countFunEligible(filter, new Date(), { requireRuntime: true }),
		planning && !hasErrors
			? listFunEligibleItems(filter, new Date(), { requireRuntime: true })
			: Promise.resolve([])
	]);
	const session =
		planning && !hasErrors ? planDurationSession(candidates, budgetMinutes, filmCount, seed) : null;

	return {
		genres,
		libraries,
		filter,
		errors: parsed.errors,
		eligibleCount,
		budgetMinutes: budgetMinutes || 240,
		filmCount,
		planning,
		session
	};
};
