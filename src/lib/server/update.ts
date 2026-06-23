import { fetchJson } from '$lib/server/http';
import { version } from '$lib/version';
import { isNewerVersion } from './semver';

/**
 * Lightweight update check against the GitHub Releases API. Cached through the
 * shared HTTP cache so the network call happens at most a few times a day.
 */

const RELEASES_URL = 'https://api.github.com/repos/diegopeixoto/posterpilot/releases/latest';
const RELEASES_PAGE = 'https://github.com/diegopeixoto/posterpilot/releases';

export interface UpdateInfo {
	current: string;
	latest: string | null;
	updateAvailable: boolean;
	url: string;
}

/** Check GitHub for a newer release. Never throws — returns "no update" on failure. */
export async function checkForUpdate(): Promise<UpdateInfo> {
	const base: UpdateInfo = {
		current: version,
		latest: null,
		updateAvailable: false,
		url: RELEASES_PAGE
	};
	try {
		const json = await fetchJson<{ tag_name?: string; html_url?: string }>(RELEASES_URL, {
			headers: { 'User-Agent': 'posterpilot', Accept: 'application/vnd.github+json' },
			cacheTtlDays: 0.25, // ~6 hours
			retries: 1,
			timeoutMs: 6000
		});
		const latest = json.tag_name ? json.tag_name.replace(/^v/i, '') : null;
		return {
			current: version,
			latest,
			updateAvailable: latest ? isNewerVersion(latest, version) : false,
			url: json.html_url ?? RELEASES_PAGE
		};
	} catch {
		return base;
	}
}
