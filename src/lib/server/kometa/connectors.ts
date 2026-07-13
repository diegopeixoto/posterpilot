/**
 * Catalog of Kometa service-connector sections and their fields, used to render
 * the Connections forms and to drive the consistency checker. Field keys are
 * verified against kometa.wiki (current docs). Auto-populated auth blocks
 * (`trakt.authorization`, `mal.authorization.*`) are intentionally excluded —
 * Kometa writes those itself and merge mode preserves them.
 *
 * Pure data — safe to import from server orchestration and (via the page load)
 * the client.
 */

import { MANAGED_SETTING_SECRET_PATHS } from './managed-settings';

export type FieldType = 'text' | 'secret' | 'url' | 'bool' | 'int';

export interface ConnectorField {
	key: string;
	type: FieldType;
	required?: boolean;
	note?: string;
}

export interface Connector {
	/** Top-level `config.yml` section key. */
	section: string;
	/** Human label (also an i18n key suffix `kometa_connector_<section>`). */
	label: string;
	/** Whether a live connection test is meaningful. */
	testable?: boolean;
	/**
	 * For plex/tmdb the core credential fields are sourced from PosterPilot's own
	 * stored settings, not entered here. True means "show as managed-by-PosterPilot".
	 */
	credsFromPosterPilot?: boolean;
	fields: readonly ConnectorField[];
}

export const CONNECTORS: readonly Connector[] = Object.freeze([
	{
		section: 'plex',
		label: 'Plex',
		testable: true,
		credsFromPosterPilot: true,
		fields: [
			{ key: 'url', type: 'url', required: true },
			{ key: 'token', type: 'secret', required: true },
			{ key: 'timeout', type: 'int' },
			{ key: 'db_cache', type: 'int' },
			{ key: 'clean_bundles', type: 'bool' },
			{ key: 'empty_trash', type: 'bool' },
			{ key: 'optimize', type: 'bool' },
			{ key: 'verify_ssl', type: 'bool' }
		]
	},
	{
		section: 'tmdb',
		label: 'TMDB',
		testable: true,
		credsFromPosterPilot: true,
		fields: [
			{ key: 'apikey', type: 'secret', required: true },
			{ key: 'language', type: 'text' },
			{ key: 'region', type: 'text' },
			{ key: 'cache_expiration', type: 'int' }
		]
	},
	{
		section: 'tautulli',
		label: 'Tautulli',
		testable: true,
		fields: [
			{ key: 'url', type: 'url', required: true },
			{ key: 'apikey', type: 'secret', required: true }
		]
	},
	{
		section: 'trakt',
		label: 'Trakt',
		fields: [
			{ key: 'client_id', type: 'secret', required: true },
			{ key: 'client_secret', type: 'secret', required: true },
			{ key: 'pin', type: 'secret', note: 'Used once to authorize; Kometa fills authorization.' },
			{ key: 'force_refresh', type: 'bool' }
		]
	},
	{
		section: 'mdblist',
		label: 'MDBList',
		fields: [
			{ key: 'apikey', type: 'secret', required: true },
			{ key: 'cache_expiration', type: 'int' }
		]
	},
	{
		section: 'omdb',
		label: 'OMDb',
		fields: [
			{ key: 'apikey', type: 'secret', required: true },
			{ key: 'cache_expiration', type: 'int' }
		]
	},
	{
		section: 'github',
		label: 'GitHub',
		fields: [{ key: 'token', type: 'secret', note: 'Optional — only to avoid GitHub rate limits.' }]
	},
	{
		section: 'radarr',
		label: 'Radarr',
		testable: true,
		fields: [
			{ key: 'url', type: 'url', required: true },
			{ key: 'token', type: 'secret', required: true },
			{ key: 'add_missing', type: 'bool' },
			{ key: 'add_existing', type: 'bool' },
			{ key: 'upgrade_existing', type: 'bool' },
			{ key: 'monitor_existing', type: 'bool' },
			{ key: 'root_folder_path', type: 'text' },
			{ key: 'monitor', type: 'bool' },
			{ key: 'availability', type: 'text', note: 'announced | cinemas | released | db' },
			{ key: 'quality_profile', type: 'text' },
			{ key: 'tag', type: 'text' },
			{ key: 'search', type: 'bool' },
			{ key: 'radarr_path', type: 'text' },
			{ key: 'plex_path', type: 'text' },
			{ key: 'ignore_cache', type: 'bool' }
		]
	},
	{
		section: 'sonarr',
		label: 'Sonarr',
		testable: true,
		fields: [
			{ key: 'url', type: 'url', required: true },
			{ key: 'token', type: 'secret', required: true },
			{ key: 'add_missing', type: 'bool' },
			{ key: 'add_existing', type: 'bool' },
			{ key: 'upgrade_existing', type: 'bool' },
			{ key: 'monitor_existing', type: 'bool' },
			{ key: 'root_folder_path', type: 'text' },
			{
				key: 'monitor',
				type: 'text',
				note: 'all | future | missing | existing | pilot | firstSeason | latestSeason | none'
			},
			{ key: 'quality_profile', type: 'text' },
			{ key: 'language_profile', type: 'text' },
			{ key: 'series_type', type: 'text', note: 'standard | anime | daily' },
			{ key: 'season_folder', type: 'bool' },
			{ key: 'tag', type: 'text' },
			{ key: 'search', type: 'bool' },
			{ key: 'cutoff_search', type: 'bool' },
			{ key: 'sonarr_path', type: 'text' },
			{ key: 'plex_path', type: 'text' },
			{ key: 'ignore_cache', type: 'bool' }
		]
	},
	{
		section: 'notifiarr',
		label: 'Notifiarr',
		fields: [{ key: 'apikey', type: 'secret', required: true }]
	},
	{
		section: 'gotify',
		label: 'Gotify',
		fields: [
			{ key: 'url', type: 'url', required: true },
			{ key: 'token', type: 'secret', required: true }
		]
	},
	{
		section: 'ntfy',
		label: 'ntfy',
		fields: [
			{ key: 'url', type: 'url', required: true },
			{ key: 'token', type: 'secret' },
			{ key: 'topic', type: 'text', required: true }
		]
	},
	{
		section: 'anidb',
		label: 'AniDB',
		fields: [
			{ key: 'language', type: 'text' },
			{ key: 'cache_expiration', type: 'int' },
			{ key: 'enable_mature', type: 'bool' }
		]
	},
	{
		section: 'mal',
		label: 'MyAnimeList',
		fields: [
			{ key: 'client_id', type: 'secret', required: true },
			{ key: 'client_secret', type: 'secret', required: true },
			{ key: 'localhost_url', type: 'url' }
		]
	}
]);

const BY_SECTION = new Map(CONNECTORS.map((c) => [c.section, c]));

/** Resolve a connector by its section key. */
export function connectorBySection(section: string): Connector | undefined {
	return BY_SECTION.get(section);
}

/** Set of field keys that are secrets, per connector section (for masking/redaction). */
export function secretFieldKeys(section: string): Set<string> {
	const c = BY_SECTION.get(section);
	return new Set((c?.fields ?? []).filter((f) => f.type === 'secret').map((f) => f.key));
}

/**
 * Every connector secret field as a `section.key` path (e.g. `plex.token`,
 * `tautulli.apikey`, `trakt.client_secret`) — for redacting diff before/after
 * values shown in the browser.
 */
export const SECRET_PATHS: ReadonlySet<string> = new Set([
	...CONNECTORS.flatMap((c) =>
		c.fields.filter((f) => f.type === 'secret').map((f) => `${c.section}.${f.key}`)
	),
	...MANAGED_SETTING_SECRET_PATHS
]);

/**
 * Default collection/overlay/chart names that REQUIRE a connector section to be
 * configured. Used by the consistency checker. Verified against kometa.wiki.
 */
export const CONNECTOR_DEPENDENCIES: readonly { feature: string; requiresConnector: string }[] =
	Object.freeze([
		{ feature: 'trakt', requiresConnector: 'trakt' },
		{ feature: 'tautulli', requiresConnector: 'tautulli' },
		{ feature: 'myanimelist', requiresConnector: 'mal' },
		{ feature: 'anilist', requiresConnector: 'anidb' },
		{ feature: 'ratings', requiresConnector: 'mdblist' }
	]);

/** Manual-derived help: per-connector description + docUrl + per-field help. */
export interface ConnectorDoc {
	readonly docUrl: string;
	readonly description: string;
	readonly fields: Readonly<Record<string, string>>;
}

export const CONNECTOR_DOCS: Readonly<Record<string, ConnectorDoc>> = Object.freeze({
	plex: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/plex/',
		description:
			'Connects Kometa to your Plex Media Server so it can read libraries and apply collections, overlays, and metadata.',
		fields: {
			url: "Your Plex server's network address including port, e.g. http://192.168.1.12:32400.",
			token: 'Authentication token used to access your Plex server.',
			timeout: 'Maximum seconds to wait for the Plex server to respond before timing out.',
			db_cache: 'Amount of memory (MB) Plex allocates to its database cache.',
			clean_bundles: "Runs Plex's Clean Bundles to remove unused bundle files after processing.",
			empty_trash:
				'Empties the library trash, permanently deleting trashed items after operations finish.',
			optimize: 'Optimizes (defragments) the Plex database to improve performance after a run.',
			verify_ssl: 'Whether to validate SSL certificates when communicating with Plex.'
		}
	}),
	tmdb: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/tmdb/',
		description:
			'Connects Kometa to TheMovieDB to resolve titles and power TMDb-based collections, metadata, and chart builders.',
		fields: {
			apikey: 'Your TMDb V3 API key used to authenticate with TheMovieDB.',
			language: 'ISO 639-1 code setting the language TMDb returns data in.',
			region: 'ISO 3166-1 code used by TMDb chart builders to filter content by region.',
			cache_expiration:
				'Days before each cached TMDb mapping expires and is re-cached (default 60).'
		}
	}),
	tautulli: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/tautulli/',
		description:
			'Connects Kometa to Tautulli so it can build collections from your watch statistics and user activity.',
		fields: {
			url: 'Network address where your Tautulli instance is reachable, e.g. http://192.168.1.12:8659.',
			apikey: 'Tautulli API key used to authenticate access to its API.'
		}
	}),
	trakt: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/trakt/',
		description:
			'Connects Kometa to your Trakt.tv account to enable Trakt-based collections and list syncing.',
		fields: {
			client_id: 'The unique identifier for your Trakt API application.',
			client_secret: 'The private key paired with your Trakt application.',
			pin: "Temporary code from Trakt's authorization page used to complete first-time authentication.",
			force_refresh: 'Whether to renew the Trakt access credentials on every run.'
		}
	}),
	mdblist: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/mdblist/',
		description:
			'Connects Kometa to MDBList to mass-edit metadata and build collections from MDBList data.',
		fields: {
			apikey: 'MDBList API key from mdblist.com/preferences (free tier allows 1000 requests/day).',
			cache_expiration:
				'Days before each cached MDBList mapping expires and is re-cached (default 60).'
		}
	}),
	omdb: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/omdb/',
		description: 'Connects Kometa to OMDb so it can mass-edit metadata using IMDb data.',
		fields: {
			apikey: 'OMDb API key from omdbapi.com/apikey.aspx (free tier allows 1000 requests/day).',
			cache_expiration:
				'Days before each cached OMDb mapping expires and is re-cached (default 60).'
		}
	}),
	github: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/github/',
		description:
			'Connects Kometa to GitHub to fetch configuration and data files with a higher rate limit.',
		fields: {
			token:
				'Personal access token (read access to public repos only) that raises GitHub request rate limits.'
		}
	}),
	radarr: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/radarr/',
		description:
			'Connects Kometa to Radarr so it can add, monitor, and search for movies referenced by your collections.',
		fields: {
			url: 'Network address of your Radarr server instance.',
			token: 'Radarr API key used to authenticate requests.',
			add_missing: 'Whether to automatically add collection movies that are missing from Radarr.',
			add_existing: 'Whether to add movies already present in Plex to Radarr.',
			upgrade_existing:
				"Whether to update existing movies' quality profile to the collection's setting.",
			monitor_existing: 'Whether to apply the monitoring preference to movies already in Radarr.',
			root_folder_path: 'Default directory where newly added movies are stored.',
			monitor: 'Whether newly added movies are set to monitored.',
			availability: 'Minimum availability (release stage) threshold for added movies.',
			quality_profile: 'Name of the Radarr quality profile applied to new additions.',
			tag: 'Tags assigned to movies added by Kometa.',
			search: 'Whether to trigger an immediate search after adding a movie.',
			radarr_path: "Radarr's file path, used for path translation between Radarr and Plex.",
			plex_path: "Plex's file path, used for path translation between Radarr and Plex.",
			ignore_cache: "Whether to bypass Kometa's cache when communicating with Radarr."
		}
	}),
	sonarr: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/sonarr/',
		description:
			'Connects Kometa to Sonarr so it can add, monitor, and search for series referenced by your collections.',
		fields: {
			url: 'Sonarr server URL including port and any URL base.',
			token: 'Sonarr API key used to authenticate requests.',
			add_missing: 'Whether to automatically add collection shows that are missing from Sonarr.',
			add_existing: 'Whether to add shows already present in Plex to Sonarr.',
			upgrade_existing:
				"Whether to update existing shows' quality profile to the collection's setting.",
			monitor_existing: 'Whether to apply the monitoring preference to shows already in Sonarr.',
			root_folder_path: 'Default directory where newly added shows are stored.',
			monitor:
				'Which episodes to monitor: all, future, missing, existing, pilot, first, latest, or none.',
			quality_profile: 'Name of the Sonarr quality profile applied to new additions.',
			language_profile: 'Sonarr language profile to apply (defaults to the first available).',
			series_type: 'Series classification for added shows: standard, daily, or anime.',
			season_folder: 'Whether to organize episodes into season-specific folders.',
			tag: 'Tags assigned to shows added by Kometa.',
			search: 'Whether to start a search for missing episodes after adding a show.',
			cutoff_search: "Whether to search for episodes that don't meet the quality cutoff.",
			sonarr_path: "Sonarr's file path, used for path translation between Sonarr and Plex.",
			plex_path: "Plex's file path, used for path translation between Sonarr and Plex.",
			ignore_cache: "Whether to bypass Kometa's cache when communicating with Sonarr."
		}
	}),
	notifiarr: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/notifiarr/',
		description:
			"Routes Kometa's webhook notifications (errors, updates, run start/end, changes) to the Notifiarr service.",
		fields: {
			apikey: 'Your Notifiarr API key used to authenticate and route notifications.'
		}
	}),
	gotify: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/gotify/',
		description: "Sends Kometa's webhook notifications straight to your Gotify server.",
		fields: {
			url: 'Address where your Gotify instance is hosted.',
			token: 'Gotify application token used to authenticate notifications.'
		}
	}),
	ntfy: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/ntfy/',
		description: "Sends Kometa's webhook notifications to the ntfy push notification service.",
		fields: {
			url: 'ntfy server URL, e.g. https://ntfy.sh or your self-hosted instance.',
			token: 'ntfy access token used to authenticate when publishing notifications.',
			topic: 'The ntfy topic (channel) that notifications are published to.'
		}
	}),
	anidb: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/anidb/',
		description:
			'Connects Kometa to AniDB for anime data and AniDB-based collections and operations.',
		fields: {
			language: 'ISO 639-1 code for the language AniDB results are returned in.',
			cache_expiration:
				'Days before each cached AniDB mapping expires and is re-cached (default 60).',
			enable_mature: 'Whether to include adult/mature anime in results (excluded when false).'
		}
	}),
	mal: Object.freeze({
		docUrl: 'https://kometa.wiki/en/latest/config/myanimelist/',
		description:
			'Connects Kometa to MyAnimeList via OAuth to enable MyAnimeList-based collections and operations.',
		fields: {
			client_id: 'The client ID of your registered MyAnimeList API application.',
			client_secret: 'The client secret paired with your client ID for authenticating requests.',
			localhost_url: 'The OAuth redirect URL used to capture the authorization code during setup.'
		}
	})
});

/** Resolve the manual help for a connector section. */
export function connectorDoc(section: string): ConnectorDoc | undefined {
	return CONNECTOR_DOCS[section];
}
