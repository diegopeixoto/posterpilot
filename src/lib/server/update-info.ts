// Pure mapping from the GitHub Releases responses to UpdateInfo. Kept free of
// $env / HTTP imports (only ./semver, which is itself pure) so it unit-tests
// cleanly — the network I/O lives in update.ts.
import { isNewerVersion } from './semver';

export const RELEASES_PAGE = 'https://github.com/diegopeixoto/posterpilot/releases';

/** The subset of the GitHub release payload we read. */
export interface GhRelease {
	tag_name?: string;
	html_url?: string;
	name?: string;
	body?: string;
}

export interface UpdateInfo {
	current: string;
	latest: string | null;
	updateAvailable: boolean;
	/** The latest release's page URL (for the "update available" banner). */
	url: string;
	/** The latest release's display name (GitHub `name`), or null when unavailable. */
	name: string | null;
	/** The latest release's notes (GitHub `body`, Markdown), or null when unavailable. */
	body: string | null;
	/** The running version's release name — for the post-upgrade "What's new" modal. */
	currentName: string | null;
	/** The running version's release notes (Markdown) — what the user just upgraded to. */
	currentBody: string | null;
	/** The running version's release page URL. */
	currentUrl: string;
}

/** Normalize a release's display name: trimmed non-empty `name`, else null. */
function displayName(release: GhRelease): string | null {
	return release.name?.trim() ? release.name : null;
}

/** Normalize a release's notes: trimmed non-empty `body`, else null. */
function notes(release: GhRelease): string | null {
	return release.body?.trim() ? release.body : null;
}

/**
 * Build an UpdateInfo from the two independent GitHub responses:
 * - `latestRes`: the latest published release (drives the "update available" banner)
 * - `currentRes`: the running version's release-by-tag (drives the "What's new" modal)
 *
 * Either may be null when its request failed; the result degrades gracefully
 * (no banner / no notes) without affecting the other.
 */
export function buildUpdateInfo(
	currentVersion: string,
	latestRes: GhRelease | null,
	currentRes: GhRelease | null
): UpdateInfo {
	const info: UpdateInfo = {
		current: currentVersion,
		latest: null,
		updateAvailable: false,
		url: RELEASES_PAGE,
		name: null,
		body: null,
		currentName: null,
		currentBody: null,
		currentUrl: RELEASES_PAGE
	};

	if (currentRes) {
		info.currentName = displayName(currentRes);
		info.currentBody = notes(currentRes);
		info.currentUrl = currentRes.html_url ?? RELEASES_PAGE;
	}

	if (latestRes) {
		const latest = latestRes.tag_name ? latestRes.tag_name.replace(/^v/i, '') : null;
		info.latest = latest;
		info.updateAvailable = latest ? isNewerVersion(latest, currentVersion) : false;
		info.url = latestRes.html_url ?? RELEASES_PAGE;
		info.name = displayName(latestRes);
		info.body = notes(latestRes);
	}

	return info;
}
