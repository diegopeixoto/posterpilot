import { randomUUID } from 'node:crypto';
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { canonicalFunActiveUrl } from '$lib/fun-active-context';
import { validatePickFilter } from '$lib/server/fun-pick';
import { buildGallerySlides, type GalleryMode } from '$lib/server/fun-gallery';
import { listFunGalleryItems, listFunLibraries, listGenres } from '$lib/server/queries';
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
	const filter = {
		...parsed.filter,
		serverInstanceId: active?.id ?? '__no_active_server__'
	};
	const rawMode = url.searchParams.get('artwork');
	const mode: GalleryMode = rawMode === 'poster' || rawMode === 'background' ? rawMode : 'mixed';
	const rawInterval = Number(url.searchParams.get('interval'));
	const intervalSeconds = [3, 5, 8, 12, 20].includes(rawInterval) ? rawInterval : 8;
	const rawSeed = url.searchParams.get('seed');
	const seed = rawSeed && /^[A-Za-z0-9_-]{1,64}$/.test(rawSeed) ? rawSeed : randomUUID();
	const [genres, artworkItems] = await Promise.all([
		filter.serverInstanceId ? listGenres(filter.serverInstanceId) : Promise.resolve([]),
		listFunGalleryItems(filter, mode)
	]);
	return {
		genres,
		libraries,
		filter,
		mode,
		intervalSeconds,
		seed,
		slides: buildGallerySlides(artworkItems, mode, seed)
	};
};
