/**
 * Resolve around the current item's frozen position, while omitting entries that
 * no longer match. This also works after the current item itself leaves the view.
 */
export function resolveStableReviewNeighbors(
	frozenIds: readonly number[],
	matchingIds: readonly number[],
	currentItemId: number
): { previousItemId: number | null; nextItemId: number | null } | null {
	const index = frozenIds.indexOf(currentItemId);
	if (index < 0) return null;
	const matching = new Set(matchingIds);
	let previousItemId: number | null = null;
	let nextItemId: number | null = null;
	for (let cursor = index - 1; cursor >= 0; cursor--) {
		const id = frozenIds[cursor];
		if (matching.has(id)) {
			previousItemId = id;
			break;
		}
	}
	for (let cursor = index + 1; cursor < frozenIds.length; cursor++) {
		const id = frozenIds[cursor];
		if (matching.has(id)) {
			nextItemId = id;
			break;
		}
	}
	return { previousItemId, nextItemId };
}

/** Validate an inbox return path and bind its focus to the current item. */
export function reviewReturnPath(path: string | null | undefined, itemId: number): string | null {
	if (
		!path ||
		!path.startsWith('/') ||
		path.startsWith('//') ||
		path.includes('\\') ||
		!Number.isSafeInteger(itemId) ||
		itemId <= 0
	) {
		return null;
	}
	try {
		const url = new URL(path, 'http://posterpilot.local');
		if (url.origin !== 'http://posterpilot.local' || url.pathname !== '/review') return null;
		url.searchParams.set('focus', String(itemId));
		return `${url.pathname}${url.search}`;
	} catch {
		return null;
	}
}

export function reviewItemPath(itemId: number, returnTo: string, contextId: string): string {
	const params = new URLSearchParams({ returnTo, reviewContext: contextId });
	return `/item/${itemId}?${params.toString()}`;
}
