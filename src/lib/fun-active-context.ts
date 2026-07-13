/**
 * FUN is always scoped to the globally active media server. Remove legacy/local
 * server selectors and any library key that is not available in that active scope.
 */
export function canonicalFunActiveUrl(
	url: URL,
	activeLibraryKeys: ReadonlySet<string>
): string | null {
	const canonical = new URL(url);
	let changed = canonical.searchParams.has('server');
	canonical.searchParams.delete('server');
	const library = canonical.searchParams.get('library')?.trim();
	if (library && !activeLibraryKeys.has(library)) {
		canonical.searchParams.delete('library');
		changed = true;
	}
	return changed ? `${canonical.pathname}${canonical.search}` : null;
}
