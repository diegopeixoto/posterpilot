const POSTER_GRID_KEYS = [
	'ArrowLeft',
	'ArrowRight',
	'ArrowUp',
	'ArrowDown',
	'Home',
	'End'
] as const;

export type PosterGridKey = (typeof POSTER_GRID_KEYS)[number];

export function isPosterGridKey(key: string): key is PosterGridKey {
	return (POSTER_GRID_KEYS as readonly string[]).includes(key);
}

/** Return the next focused poster without allowing focus to escape the grid bounds. */
export function nextPosterGridIndex(
	current: number,
	key: PosterGridKey,
	columns: number,
	length: number
): number {
	if (length <= 0) return -1;
	const safeColumns = Math.max(1, Math.floor(columns));
	const safeCurrent = Math.min(Math.max(0, current), length - 1);

	switch (key) {
		case 'ArrowLeft':
			return Math.max(0, safeCurrent - 1);
		case 'ArrowRight':
			return Math.min(length - 1, safeCurrent + 1);
		case 'ArrowUp':
			return Math.max(0, safeCurrent - safeColumns);
		case 'ArrowDown':
			return Math.min(length - 1, safeCurrent + safeColumns);
		case 'Home':
			return 0;
		case 'End':
			return length - 1;
	}
}
