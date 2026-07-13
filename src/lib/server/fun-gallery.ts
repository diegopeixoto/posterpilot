import { rankFunItems } from './fun-pick';

export type GalleryMode = 'poster' | 'background' | 'mixed';

export interface GalleryArtworkItem {
	id: number;
	title: string;
	hasPoster: boolean;
	hasBackground: boolean;
	artworkVersion?: number;
	posterVersion?: string | number | null;
	backgroundVersion?: string | number | null;
}

export interface GallerySlide {
	id: string;
	itemId: number;
	title: string;
	kind: 'poster' | 'background';
	artworkVersion: string | number;
}

/** Build unique, seeded gallery slides while respecting artwork availability. */
export function buildGallerySlides(
	items: readonly GalleryArtworkItem[],
	mode: GalleryMode,
	seed: string
): GallerySlide[] {
	const ranked = rankFunItems(items, seed);
	const slides: GallerySlide[] = [];
	for (let index = 0; index < ranked.length; index += 1) {
		const item = ranked[index];
		let kind: GallerySlide['kind'] | null = null;
		if (mode === 'poster') kind = item.hasPoster ? 'poster' : null;
		else if (mode === 'background') kind = item.hasBackground ? 'background' : null;
		else if (item.hasPoster && item.hasBackground) kind = index % 2 === 0 ? 'background' : 'poster';
		else if (item.hasBackground) kind = 'background';
		else if (item.hasPoster) kind = 'poster';
		if (kind) {
			slides.push({
				id: `${item.id}:${kind}`,
				itemId: item.id,
				title: item.title,
				kind,
				artworkVersion:
					(kind === 'poster' ? item.posterVersion : item.backgroundVersion) ??
					item.artworkVersion ??
					0
			});
		}
	}
	return slides;
}
