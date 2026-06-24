import { fetchJson } from '$lib/server/http';
import { version } from '$lib/version';
import { USER_AGENT } from './ua';
import { isNewerVersion } from './semver';

/**
 * Lightweight update check against the GitHub Releases API. Cached through the
 * shared HTTP cache so the network call happens at most a few times a day.
 */

const RELEASES_URL = 'https://api.github.com/repos/diegopeixoto/posterpilot/releases/latest';
const RELEASES_PAGE = 'https://github.com/diegopeixoto/posterpilot/releases';

const RELEASE_BY_TAG = (tag: string) =>
	`https://api.github.com/repos/diegopeixoto/posterpilot/releases/tags/${tag}`;

const GH_HEADERS = { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' };

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

interface GhRelease {
	tag_name?: string;
	html_url?: string;
	name?: string;
	body?: string;
}

/** Fetch a single release by tag. Notes for a published tag are immutable, so
 *  cache them for a long time. Returns null on any failure. */
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
	const base: UpdateInfo = {
		current: version,
		latest: null,
		updateAvailable: false,
		url: RELEASES_PAGE,
		name: null,
		body: null,
		currentName: null,
		currentBody: null,
		currentUrl: RELEASES_PAGE
	};
	// The running version's own notes (for "What's new") and the latest release
	// (for the "update available" banner) are independent — fetch both.
	const [latestRes, currentRes] = await Promise.all([
		fetchJson<GhRelease>(RELEASES_URL, {
			headers: GH_HEADERS,
			cacheTtlDays: 0.25, // ~6 hours
			retries: 1,
			timeoutMs: 6000
		}).catch(() => null),
		fetchReleaseByTag(`v${version}`)
	]);

	const result = { ...base };
	if (currentRes) {
		result.currentName = currentRes.name?.trim() ? currentRes.name : null;
		result.currentBody = currentRes.body?.trim() ? currentRes.body : null;
		result.currentUrl = currentRes.html_url ?? RELEASES_PAGE;
	}
	if (latestRes) {
		const latest = latestRes.tag_name ? latestRes.tag_name.replace(/^v/i, '') : null;
		result.latest = latest;
		result.updateAvailable = latest ? isNewerVersion(latest, version) : false;
		result.url = latestRes.html_url ?? RELEASES_PAGE;
		result.name = latestRes.name?.trim() ? latestRes.name : null;
		result.body = latestRes.body?.trim() ? latestRes.body : null;
	}
	return result;
}
