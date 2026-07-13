import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canonicalFunActiveUrl } from '$lib/fun-active-context';
import { funResultId, parseFunSharedItemIds, validatePickFilter } from '$lib/server/fun-pick';
import {
	countFunEligible,
	getFunLibraryBounds,
	listFunLibraries,
	listFunItemsByIds,
	listGenres,
	pickFunChoices
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

	const { filter, errors } = validatePickFilter(url.searchParams);
	const requestedSeed = filter.seed ?? url.searchParams.get('pick') ?? undefined;
	const seed =
		requestedSeed && /^[A-Za-z0-9_-]{1,64}$/.test(requestedSeed) ? requestedSeed : randomUUID();
	const picking = url.searchParams.has('pick') || filter.seed !== undefined;
	const hasErrors = Object.keys(errors).length > 0;
	const sharedItemIds = parseFunSharedItemIds(url.searchParams.get('ids'));
	const effectiveFilter = {
		...filter,
		serverInstanceId: active?.id ?? '__no_active_server__',
		seed
	};

	const [genres, bounds, eligibleCount, choices] = await Promise.all([
		effectiveFilter.serverInstanceId
			? listGenres(effectiveFilter.serverInstanceId)
			: Promise.resolve([]),
		getFunLibraryBounds(effectiveFilter),
		countFunEligible(effectiveFilter),
		picking && !hasErrors
			? sharedItemIds.length && effectiveFilter.serverInstanceId
				? listFunItemsByIds(sharedItemIds, effectiveFilter.serverInstanceId)
				: pickFunChoices(effectiveFilter, seed)
			: Promise.resolve([])
	]);

	if (picking && !hasErrors && sharedItemIds.length === 0 && choices.length > 0) {
		const canonical = new URL(url);
		canonical.searchParams.set('ids', choices.map((item) => item.id).join(','));
		throw redirect(303, canonical.pathname + canonical.search);
	}
	const availableIds = new Set(choices.map((item) => item.id));
	const unavailableChoiceIds = sharedItemIds.filter((id) => !availableIds.has(id));

	return {
		genres,
		libraries,
		bounds,
		filter: effectiveFilter,
		errors,
		eligibleCount,
		choices,
		unavailableChoiceIds,
		// Compatibility while the picker view evolves from one card to a choice set.
		picked: choices[0] ?? null,
		picking,
		resultId: choices.length
			? funResultId(
					seed,
					choices.map((item) => item.id)
				)
			: null
	};
};
