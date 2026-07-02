import { m } from '$lib/paraglide/messages';
import type { LibrarySort } from '$lib/library-sort';

/**
 * One label per library sort, shared by every `<select>`/chip that enumerates
 * `LIBRARY_SORTS` (library toolbar, settings default-sort) so a new sort can't
 * be added to one list and missed in another. Kept out of `library-sort.ts`
 * so that module stays free of generated-code imports for its unit tests.
 */
export const sortLabels: Record<LibrarySort, () => string> = {
	title: m.library_sort_title,
	rating: m.library_sort_rating,
	year: m.library_sort_year,
	runtime: m.library_sort_runtime,
	recent: m.library_sort_recent,
	added: m.library_sort_added
};
