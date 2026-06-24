import { fetchJson } from '$lib/server/http';
import { version } from '$lib/version';
import { USER_AGENT } from './ua';
import { buildUpdateInfo, type GhRelease, type UpdateInfo } from './update-info';

/**
 * Lightweight update check against the GitHub Releases API. Cached through the
 * shared HTTP cache so the network call happens at most a few times a day. The
 * response → UpdateInfo mapping lives in ./update-info (pure, unit-tested).
 */

export type { UpdateInfo } from './update-info';

const RELEASES_URL = 'https://api.github.com/repos/diegopeixoto/posterpilot/releases/latest';

const RELEASE_BY_TAG = (tag: string) =>
	`https://api.github.com/repos/diegopeixoto/posterpilot/releases/tags/${tag}`;

const GH_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' };

/** Fetch a single release by tag. Notes for an existing tag rarely change
 *  (they can be edited, but seldom are), so cache them for a long time. Returns
 *  null on any failure. */
async function fetchReleaseByTag(tag: string): Promise<GhRelease | null> {
	try {
		return await fetchJson<GhRelease>(RELEASE_BY_TAG(tag), {
			headers: GH_HEADERS,
			cacheTtlDays: 30,
			retries: 1,
			timeoutMs: 6000
		});
	} catch {
		return null;
	}
}

/** Check GitHub for a newer release. Never throws — returns "no update" on failure. */
export async function checkForUpdate(): Promise<UpdateInfo> {
	// The running version's own notes (for "What's new") and the latest release
	// (for the "update available" banner) are independent — fetch both.
	const [latestRes, currentRes] = await Promise.all([
		fetchJson<GhRelease>(RELEASES_URL, {
			headers: GH_HEADERS,
			cacheTtlDays: 1 / 24, // ~1 hour
			staleWhileRevalidate: true, // serve cached instantly; refresh in the background
			retries: 1,
			timeoutMs: 6000
		}).catch(() => null),
		fetchReleaseByTag(`v${version}`)
	]);

	return buildUpdateInfo(version, latestRes, currentRes);
}
