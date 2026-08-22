/**
 * Where a client-side navigation should go as a full-page load because a newer
 * build is serving, or null to let SvelteKit navigate client-side as usual.
 *
 * A tab left open across a container upgrade keeps running the old bundle: the
 * server sends fresh data, so the page looks current, but its JavaScript is the
 * previous release (#115). SvelteKit only falls back to a full page on its own
 * when a navigation needs a chunk that no longer exists; a route already in
 * memory never triggers that. So once the version poll reports a new build, the
 * next client-side navigation becomes a full load of the same target — never a
 * navigation that is already unloading the page (that would loop), and never one
 * without a destination.
 */
export function fullPageTargetForNewBuild(
	newBuildDetected: boolean,
	navigation: { willUnload: boolean; to: { url: URL } | null }
): string | null {
	if (!newBuildDetected || navigation.willUnload || !navigation.to) return null;
	return navigation.to.url.href;
}
