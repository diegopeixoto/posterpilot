import { describe, it, expect } from 'vitest';
import {
	applyPlan,
	buildOwnedDoc,
	buildPlan,
	checkConsistency,
	loadDoc,
	readDefaultList,
	readScalarMap,
	readSectionKeys,
	redactSecrets,
	scaffoldDoc,
	serialize,
	topLevelKeys,
	type ConfigPlan
} from './config';

const CREDS = { plexUrl: 'http://new:32400', plexToken: 'newtoken', tmdbKey: 'newkey' };
const META = '/data/kometa/posterpilot.yml';

function plan(overrides: Partial<Parameters<typeof buildPlan>[0]> = {}): ConfigPlan {
	return buildPlan({
		creds: CREDS,
		metadataFile: META,
		libraries: [{ name: 'Movies', defaults: ['genre', 'studio'], metadata: true }],
		...overrides
	});
}

const SAMPLE = `# My Kometa config
plex:
  url: http://old:32400
  token: oldtoken
  timeout: 60 # keep this
tmdb:
  apikey: oldkey
  language: en
libraries:
  Movies:
    collection_files:
      - default: genre # user already had genre
      - file: /my/custom.yml
settings:
  asset_directory: /assets
`;

describe('applyPlan — preservation', () => {
	it('preserves unmanaged keys and comments', () => {
		const doc = loadDoc(SAMPLE);
		const out = serialize(applyPlan(doc, plan(), null).doc);
		expect(out).toContain('# My Kometa config');
		expect(out).toContain('timeout: 60');
		expect(out).toContain('# keep this');
		expect(out).toContain('language: en');
		expect(out).toContain('asset_directory: /assets');
		expect(out).toContain('/my/custom.yml'); // user's own collection file entry
	});

	it('writes plex/tmdb connections', () => {
		const doc = loadDoc(SAMPLE);
		const { doc: out } = applyPlan(doc, plan(), null);
		expect(out.getIn(['plex', 'url'])).toBe('http://new:32400');
		expect(out.getIn(['plex', 'token'])).toBe('newtoken');
		expect(out.getIn(['tmdb', 'apikey'])).toBe('newkey');
		// untouched neighbor keys survive
		expect(out.getIn(['plex', 'timeout'])).toBe(60);
	});
});

describe('applyPlan — libraries & defaults', () => {
	it('adds the metadata_files entry and does not duplicate the user genre', () => {
		const doc = loadDoc(SAMPLE);
		const out = serialize(applyPlan(doc, plan(), null).doc);
		expect(out).toContain('metadata_files');
		expect(out).toContain(`file: ${META}`);
		expect(out).toContain('default: studio');
		// genre appears exactly once (user's original, not re-added)
		expect(out.match(/default: genre/g)?.length).toBe(1);
	});

	it('creates a brand-new managed library', () => {
		const doc = loadDoc(SAMPLE);
		const p = plan({
			libraries: [
				{ name: 'Movies', defaults: ['genre', 'studio'], metadata: true },
				{ name: 'TV Shows', defaults: ['network'], metadata: true }
			]
		});
		const out = serialize(applyPlan(doc, p, null).doc);
		expect(out).toContain('TV Shows:');
		expect(out).toContain('default: network');
	});

	it('is idempotent on re-sync (no new changes, no duplicates)', () => {
		const doc = loadDoc(SAMPLE);
		const first = applyPlan(doc, plan(), null);
		const second = applyPlan(loadDoc(serialize(first.doc)), plan(), first.nextSnapshot);
		expect(second.changes).toHaveLength(0);
		const out = serialize(second.doc);
		expect(out.match(new RegExp(`file: ${META.replace(/\//g, '\\/')}`, 'g'))?.length).toBe(1);
	});

	it('removes only our managed default on disable, never the user-authored genre', () => {
		const doc = loadDoc(SAMPLE);
		const first = applyPlan(doc, plan(), null); // owns ['studio'] (genre was the user's)
		expect(first.nextSnapshot.libraries['Movies'].defaults).toEqual(['studio']);
		// Now disable studio (and genre) → only studio (ours) should go; genre stays.
		const disabled = plan({ libraries: [{ name: 'Movies', defaults: [], metadata: true }] });
		const out = serialize(
			applyPlan(loadDoc(serialize(first.doc)), disabled, first.nextSnapshot).doc
		);
		expect(out).not.toContain('default: studio');
		expect(out).toContain('default: genre'); // user's entry preserved
	});

	it('removes managed entries when a library is deselected', () => {
		const doc = loadDoc(SAMPLE);
		const first = applyPlan(doc, plan(), null);
		const none = plan({ libraries: [] });
		const out = serialize(applyPlan(loadDoc(serialize(first.doc)), none, first.nextSnapshot).doc);
		expect(out).not.toContain(`file: ${META}`);
		expect(out).toContain('default: genre'); // user's content stays, library block intact
	});
});

describe('applyPlan — settings & secrets', () => {
	it('manages bounded settings and removes them when un-managed', () => {
		const doc = loadDoc(SAMPLE);
		const withSetting = plan({
			settings: [{ section: 'webhooks', key: 'error', value: 'https://hook' }]
		});
		const first = applyPlan(doc, withSetting, null);
		expect(serialize(first.doc)).toContain('error: https://hook');
		const out = serialize(applyPlan(loadDoc(serialize(first.doc)), plan(), first.nextSnapshot).doc);
		expect(out).not.toContain('https://hook');
	});

	it('redacts secret values in the diff', () => {
		const doc = loadDoc(SAMPLE);
		const { changes } = applyPlan(doc, plan(), null);
		const redacted = redactSecrets(changes);
		const token = redacted.find((c) => c.path === 'plex.token');
		expect(token?.after).toBe('***');
		const url = redacted.find((c) => c.path === 'plex.url');
		expect(url?.after).toBe('http://new:32400'); // non-secret untouched
	});

	it('redacts all managed webhook URLs in a structured diff', () => {
		const webhook = 'https://discord.com/api/webhooks/123/secret-token';
		const { changes } = applyPlan(
			loadDoc(''),
			plan({
				settings: [
					{ section: 'webhooks', key: 'error', value: webhook },
					{ section: 'webhooks', key: 'run_start', value: webhook },
					{ section: 'webhooks', key: 'run_end', value: webhook }
				]
			}),
			null
		);
		const display = JSON.stringify(redactSecrets(changes));
		expect(display).not.toContain(webhook);
		for (const key of ['error', 'run_start', 'run_end']) {
			expect(redactSecrets(changes)).toContainEqual(
				expect.objectContaining({ path: `webhooks.${key}`, after: '***' })
			);
		}
	});

	it('keeps an existing managed webhook secret when the masked input is omitted', () => {
		const webhook = 'https://discord.com/api/webhooks/123/secret-token';
		const source = loadDoc(`webhooks:\n  error: ${webhook}\n`);
		const result = applyPlan(source, plan({ settingKeep: ['webhooks.error'] }), {
			metadataPath: META,
			libraries: {},
			managedSettingKeys: ['webhooks.error']
		});
		expect(serialize(result.doc)).toContain(webhook);
		expect(result.changes).not.toContainEqual(expect.objectContaining({ path: 'webhooks.error' }));
		expect(result.nextSnapshot.managedSettingKeys).toContain('webhooks.error');
	});
});

const NO_CREDS = { plexUrl: null, plexToken: null, tmdbKey: null };

describe('applyPlan — generalized sections', () => {
	it('manages a connector section and removes a cleared field', () => {
		const p = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [],
			connections: { tautulli: { url: 'http://tt:8181', apikey: 'k' } }
		});
		const first = applyPlan(loadDoc(''), p, null);
		const out1 = serialize(first.doc);
		expect(out1).toContain('tautulli:');
		expect(out1).toContain('url: http://tt:8181');
		expect(first.nextSnapshot.connections?.tautulli).toEqual(['url', 'apikey']);

		const p2 = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [],
			connections: { tautulli: { url: 'http://tt:8181', apikey: '' } }
		});
		const out2 = serialize(applyPlan(loadDoc(serialize(first.doc)), p2, first.nextSnapshot).doc);
		expect(out2).toContain('url: http://tt:8181');
		expect(out2).not.toContain('apikey: k');
	});

	it('preserves a blank (kept) connector secret on resync', () => {
		const p1 = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [],
			connections: { tautulli: { url: 'http://tt', apikey: 'k' } }
		});
		const first = applyPlan(loadDoc(''), p1, null);
		expect(serialize(first.doc)).toContain('apikey: k');
		// Resync: the user left apikey blank → kept via connectionKeep, not deleted.
		const p2 = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [],
			connections: { tautulli: { url: 'http://tt' } },
			connectionKeep: { tautulli: ['apikey'] }
		});
		const out = serialize(applyPlan(loadDoc(serialize(first.doc)), p2, first.nextSnapshot).doc);
		expect(out).toContain('apikey: k');
		expect(out).toContain('url: http://tt');
	});

	it('preserves a kept secret in a secret-only connector (github.token)', () => {
		const p1 = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [],
			connections: { github: { token: 'ghp_x' } }
		});
		const first = applyPlan(loadDoc(''), p1, null);
		expect(serialize(first.doc)).toContain('token: ghp_x');
		// Resync with the only field (a secret) left blank → kept, section not removed.
		const p2 = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [],
			connections: { github: {} },
			connectionKeep: { github: ['token'] }
		});
		const out = serialize(applyPlan(loadDoc(serialize(first.doc)), p2, first.nextSnapshot).doc);
		expect(out).toContain('token: ghp_x');
	});

	it('redacts connector secrets in the diff, not just plex/tmdb', () => {
		const p = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [],
			connections: { tautulli: { url: 'http://tt', apikey: 'supersecret' } }
		});
		const redacted = redactSecrets(applyPlan(loadDoc(''), p, null).changes);
		expect(redacted.find((c) => c.path === 'tautulli.apikey')?.after).toBe('***');
		expect(redacted.find((c) => c.path === 'tautulli.url')?.after).toBe('http://tt');
	});

	it('manages per-library overlays, leaving the user overlay alone', () => {
		const base = loadDoc(
			'libraries:\n  Movies:\n    overlay_files:\n      - default: ribbon # mine\n'
		);
		const p = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [
				{ name: 'Movies', defaults: [], overlays: ['mediastinger', 'ribbon'], metadata: false }
			]
		});
		const first = applyPlan(base, p, null);
		const out = serialize(first.doc);
		expect(out).toContain('default: mediastinger');
		expect(out.match(/default: ribbon/g)?.length).toBe(1); // user's, not re-added
		expect(first.nextSnapshot.libraries['Movies'].overlays).toEqual(['mediastinger']);
	});

	it('manages per-library operations and settings overrides (string-valued)', () => {
		const base = loadDoc('libraries:\n  Movies: {}\n');
		const p = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [
				{
					name: 'Movies',
					defaults: [],
					metadata: false,
					operations: { mass_genre_update: 'tmdb' },
					settingsOverrides: { asset_directory: '/assets/movies' }
				}
			]
		});
		const first = applyPlan(base, p, null);
		const out = serialize(first.doc);
		expect(out).toContain('mass_genre_update: tmdb');
		expect(out).toContain('asset_directory: /assets/movies');
		expect(first.nextSnapshot.libraries['Movies'].operations).toEqual(['mass_genre_update']);

		const p2 = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [
				{ name: 'Movies', defaults: [], metadata: false, operations: { mass_genre_update: '' } }
			]
		});
		const out2 = serialize(applyPlan(loadDoc(serialize(first.doc)), p2, first.nextSnapshot).doc);
		expect(out2).not.toContain('mass_genre_update');
	});
});

describe('readers', () => {
	const DOC = loadDoc(
		'plex:\n  url: http://p\n  token: t\nlibraries:\n  Movies:\n    collection_files:\n      - default: genre\n    overlay_files:\n      - default: ribbon\n'
	);
	it('readScalarMap reads a section', () => {
		expect(readScalarMap(DOC, ['plex'])).toEqual({ url: 'http://p', token: 't' });
		expect(readScalarMap(DOC, ['nope'])).toEqual({});
	});
	it('readSectionKeys lists library names', () => {
		expect(readSectionKeys(DOC, ['libraries'])).toEqual(['Movies']);
	});
	it('readDefaultList reads collection/overlay defaults', () => {
		expect(readDefaultList(DOC, 'Movies', 'collection_files')).toEqual(['genre']);
		expect(readDefaultList(DOC, 'Movies', 'overlay_files')).toEqual(['ribbon']);
	});
});

describe('checkConsistency', () => {
	it('warns when a chart/overlay needs a connector that is not configured', () => {
		const p = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [{ name: 'Movies', defaults: ['trakt'], overlays: ['ratings'], metadata: false }]
		});
		const warns = checkConsistency(p, loadDoc(''));
		expect(warns.find((w) => w.feature === 'trakt')?.requiresConnector).toBe('trakt');
		expect(warns.find((w) => w.feature === 'ratings')?.requiresConnector).toBe('mdblist');
	});

	it('is satisfied when the connector is in the plan or already in the file', () => {
		const p = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [{ name: 'Movies', defaults: ['trakt'], metadata: false }],
			connections: { trakt: { client_id: 'x', client_secret: 'y' } }
		});
		expect(checkConsistency(p, loadDoc('')).some((w) => w.feature === 'trakt')).toBe(false);
		// or already present in the file
		const p2 = buildPlan({
			creds: NO_CREDS,
			metadataFile: META,
			libraries: [{ name: 'Movies', defaults: ['tautulli'], metadata: false }]
		});
		const doc = loadDoc('tautulli:\n  url: http://t\n  apikey: k\n');
		expect(checkConsistency(p2, doc).some((w) => w.feature === 'tautulli')).toBe(false);
	});
});

describe('scaffoldDoc & anchors', () => {
	it('scaffolds a valid minimal config', () => {
		const out = serialize(scaffoldDoc(plan()));
		const reparsed = loadDoc(out);
		expect(reparsed.getIn(['plex', 'url'])).toBe('http://new:32400');
		expect(reparsed.getIn(['tmdb', 'apikey'])).toBe('newkey');
		expect(out).toContain('Movies:');
		expect(out).toContain('PosterPilot');
	});

	it('builds a fully-owned doc and reports dropped keys vs an existing file', () => {
		const owned = buildOwnedDoc(plan());
		const ownedYaml = serialize(owned.doc);
		expect(ownedYaml).toContain('own mode');
		expect(owned.doc.getIn(['plex', 'url'])).toBe('http://new:32400');
		// A user's hand-written `radarr:` is NOT carried into an owned doc.
		expect(ownedYaml).not.toContain('radarr');

		const existing = loadDoc(SAMPLE + 'radarr:\n  url: http://r\n');
		const ownedKeys = new Set(topLevelKeys(owned.doc));
		const dropped = topLevelKeys(existing).filter((k) => !ownedKeys.has(k));
		expect(dropped).toContain('radarr');
		expect(dropped).toContain('settings'); // SAMPLE's asset_directory block is not managed here
	});

	it('skips a section that uses anchors/aliases and warns', () => {
		const anchored = `plex: &p
  url: http://x:32400
  token: t
tmdb:
  apikey: k
`;
		const { warnings, changes } = applyPlan(loadDoc(anchored), plan(), null);
		expect(warnings).toContain('plex');
		// plex edits skipped; tmdb still managed
		expect(changes.some((c) => c.path.startsWith('plex.'))).toBe(false);
	});
});
