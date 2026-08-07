import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	saveSettings: vi.fn(),
	setArtworkRankingSettings: vi.fn(),
	setIncludedSectionsForServer: vi.fn(),
	logEvent: vi.fn(),
	materializeLegacy: vi.fn(),
	getActiveServerInstance: vi.fn(),
	resolveKometaServerBinding: vi.fn(),
	resolveConfig: vi.fn(),
	loadKometaMigrationJournal: vi.fn(),
	checkpointGuard: vi.fn(),
	journals: new Map<
		string,
		{
			status: string;
			payload: {
				serverInstanceId: string;
				outputDirectory: string;
				metadataPathPrefix: string;
				config: { path: string | null; mode: string | null };
			};
		}
	>()
}));

vi.mock('$lib/server/db', async () => {
	const { createClient } = await import('@libsql/client');
	const { drizzle } = await import('drizzle-orm/libsql');
	const schema = await import('$lib/server/db/schema');
	const client = createClient({ url: ':memory:' });
	await client.execute(
		`CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)`
	);
	return { db: drizzle(client, { schema }), migrateDb: async () => undefined };
});

vi.mock('$lib/server/config', () => ({
	resolveConfig: h.resolveConfig,
	saveSettings: h.saveSettings,
	setArtworkRankingSettings: h.setArtworkRankingSettings,
	setIncludedSectionsForServer: h.setIncludedSectionsForServer
}));
vi.mock('$lib/server/events', () => ({ logEvent: h.logEvent }));
vi.mock('$lib/server/server-instances', () => ({
	materializeLegacyServerInstance: h.materializeLegacy,
	getActiveServerInstance: h.getActiveServerInstance
}));
vi.mock('$lib/server/kometa/server-binding', () => ({
	resolveKometaServerBinding: h.resolveKometaServerBinding
}));
vi.mock('$lib/server/kometa/migration-store', () => ({
	loadActiveKometaMigrationJournal: h.loadKometaMigrationJournal
}));
vi.mock('$lib/server/kometa/config-mutation-recovery', () => ({
	assertNoPendingKometaConfigMutationWhileOwned: h.checkpointGuard
}));

import { POST } from './+server';
import { withKometaMigrationControlLock } from '$lib/server/kometa/migration-control-lock';

const validRanking = {
	providerPriority: ['tmdb', 'mediux', 'theposterdb', 'fanarttv'],
	weights: {
		providerWeights: { mediux: 1, theposterdb: 0.8, fanarttv: 0.7, tmdb: 0.6 },
		resolutionWeight: 0.5,
		aspectWeight: 0.3
	}
};

function request(body: unknown) {
	return new Request('http://localhost/api/settings', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
}

function migrationJournal(
	status: string,
	overrides: {
		outputDirectory?: string;
		configPath?: string | null;
		configMode?: string | null;
	} = {}
) {
	return {
		status,
		payload: {
			serverInstanceId: 'server-a',
			outputDirectory: overrides.outputDirectory ?? '/config',
			metadataPathPrefix: 'config',
			config: {
				path: overrides.configPath === undefined ? '/config/config.yml' : overrides.configPath,
				mode: overrides.configMode === undefined ? 'merge' : overrides.configMode
			}
		}
	};
}

describe('POST /api/settings artwork ranking', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		h.journals.clear();
		h.getActiveServerInstance.mockResolvedValue({ id: 'server-a' });
		h.resolveConfig.mockResolvedValue({
			kometaServerInstanceId: 'server-a',
			kometaAssetsDir: '/data/kometa-a',
			kometaConfigPath: '/config/config.yml',
			kometaMetadataPathPrefix: 'config',
			kometaConfigMode: 'merge'
		});
		h.loadKometaMigrationJournal.mockImplementation(
			async () =>
				[...h.journals.values()].find(
					(journal) => journal.status !== 'completed' && journal.status !== 'rolled_back'
				) ?? null
		);
		h.resolveKometaServerBinding.mockResolvedValue({
			status: 'ready',
			binding: { id: 'server-a', name: 'Plex A' }
		});
		h.checkpointGuard.mockImplementation(async (assertControlLockOwned: () => Promise<unknown>) =>
			assertControlLockOwned()
		);
	});

	it('blocks Kometa scope settings while a confirmed config save needs recovery', async () => {
		h.checkpointGuard.mockRejectedValueOnce(new Error('checkpoint corrupt'));

		const response = await POST({
			request: request({ kometaConfigMode: 'own' })
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'kometa_config_recovery_required' }
		});
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.loadKometaMigrationJournal).not.toHaveBeenCalled();
	});

	it.each([
		['tmdbKey', 'new-tmdb-key'],
		['serverType', 'plex'],
		['plexUrl', 'http://plex-new:32400'],
		['plexToken', 'new-plex-token'],
		['jellyfinUrl', 'http://jellyfin-new:8096'],
		['jellyfinApiKey', 'new-jellyfin-key'],
		['embyUrl', 'http://emby-new:8096'],
		['embyApiKey', 'new-emby-key']
	] as const)('blocks checkpoint dependency setting %s until recovery', async (key, value) => {
		h.checkpointGuard.mockRejectedValueOnce(new Error('checkpoint pending'));

		const response = await POST({
			request: request({ [key]: value })
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'kometa_config_recovery_required' }
		});
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.materializeLegacy).not.toHaveBeenCalled();
	});

	it('rejects an incomplete or out-of-range definition before any write', async () => {
		const response = await POST({
			request: request({
				defaultApplyMethod: 'plex',
				ranking: {
					...validRanking,
					weights: { ...validRanking.weights, aspectWeight: 99 }
				}
			})
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: { code: 'invalid_artwork_ranking' } });
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.setArtworkRankingSettings).not.toHaveBeenCalled();
	});

	it('persists library selection only under the active server scope', async () => {
		const response = await POST({
			request: request({ includedSections: ['movies', 'shows'] })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
		expect(h.setIncludedSectionsForServer).toHaveBeenCalledWith('server-a', ['movies', 'shows']);
		expect(h.saveSettings).toHaveBeenCalledWith({}, expect.any(String));
		expect(h.logEvent).toHaveBeenCalledWith(
			'info',
			'settings',
			'Library selection changed (2 libraries)',
			{ count: 2, serverInstanceId: 'server-a' }
		);
	});

	it('rejects a non-Plex Kometa binding before saving anything', async () => {
		h.resolveKometaServerBinding.mockResolvedValue({ status: 'incompatible', binding: null });
		const response = await POST({
			request: request({ kometaServerInstanceId: 'jellyfin-b' })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: 'kometa_server_binding_incompatible' }
		});
		expect(h.saveSettings).not.toHaveBeenCalled();
	});

	it('refuses an A to B binding change while A has a nonterminal migration journal', async () => {
		h.journals.set('server-a', migrationJournal('writing_splits'));
		// A terminal journal under B proves the lookup is performed against the prior binding.
		h.journals.set('server-b', migrationJournal('completed'));
		const response = await POST({
			request: request({
				kometaServerInstanceId: 'server-b',
				includedSections: ['movies']
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'kometa_migration_config_locked' }
		});
		expect(h.loadKometaMigrationJournal).toHaveBeenCalledWith();
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.setIncludedSectionsForServer).not.toHaveBeenCalled();
	});

	it.each([
		['kometaConfigPath', '/config-b/config.yml'],
		['kometaMetadataPathPrefix', 'metadata'],
		['kometaConfigMode', 'own']
	] as const)(
		'refuses a direct API mutation of locked Kometa scope field %s',
		async (key, value) => {
			h.journals.set('server-a', migrationJournal('awaiting_manual_wiring'));
			const response = await POST({
				request: request({ [key]: value })
			} as Parameters<typeof POST>[0]);

			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error: { code: 'kometa_migration_config_locked' }
			});
			expect(h.loadKometaMigrationJournal).toHaveBeenCalledWith();
			expect(h.saveSettings).not.toHaveBeenCalled();
		}
	);

	it('locks the assets directory when it is the effective migration output', async () => {
		h.resolveConfig.mockResolvedValue({
			kometaServerInstanceId: 'server-a',
			kometaAssetsDir: '/data/kometa-a',
			kometaConfigPath: '',
			kometaMetadataPathPrefix: 'config',
			kometaConfigMode: 'merge'
		});
		h.journals.set(
			'server-a',
			migrationJournal('awaiting_manual_wiring', {
				outputDirectory: '/data/kometa-a',
				configPath: null,
				configMode: null
			})
		);
		const response = await POST({
			request: request({ kometaAssetsDir: '/data/kometa-b' })
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(409);
		expect(h.saveSettings).not.toHaveBeenCalled();
	});

	it('allows an assets-directory edit that does not change config-co-located output', async () => {
		h.journals.set('server-a', migrationJournal('writing_splits'));
		const response = await POST({
			request: request({ kometaAssetsDir: '/data/kometa-b' })
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(h.saveSettings).toHaveBeenCalledWith(
			{ kometaAssetsDir: '/data/kometa-b' },
			expect.any(String)
		);
	});

	it('allows canonical path equivalence and restoring a drifted dimension to frozen scope', async () => {
		h.journals.set('server-a', migrationJournal('writing_splits'));
		const equivalent = await POST({
			request: request({ kometaConfigPath: '/config/sub/../config.yml' })
		} as Parameters<typeof POST>[0]);
		expect(equivalent.status).toBe(200);

		h.resolveConfig.mockResolvedValue({
			kometaServerInstanceId: 'server-a',
			kometaAssetsDir: '/data/kometa-a',
			kometaConfigPath: '/drift/config.yml',
			kometaMetadataPathPrefix: 'config',
			kometaConfigMode: 'merge'
		});
		const restored = await POST({
			request: request({ kometaConfigPath: '/config/config.yml' })
		} as Parameters<typeof POST>[0]);
		expect(restored.status).toBe(200);
		expect(h.saveSettings).toHaveBeenLastCalledWith(
			{ kometaConfigPath: '/config/config.yml' },
			expect.any(String)
		);
	});

	it('allows only an exact binding restoration after an active journal drifts from A to B', async () => {
		h.journals.set('server-a', migrationJournal('writing_splits'));
		h.resolveConfig.mockResolvedValue({
			kometaServerInstanceId: 'server-b',
			kometaAssetsDir: '/data/kometa-a',
			kometaConfigPath: '/config/config.yml',
			kometaMetadataPathPrefix: 'config',
			kometaConfigMode: 'merge'
		});

		const restored = await POST({
			request: request({ kometaServerInstanceId: 'server-a' })
		} as Parameters<typeof POST>[0]);
		expect(restored.status).toBe(200);
		expect(h.saveSettings).toHaveBeenCalledWith(
			{ kometaServerInstanceId: 'server-a' },
			expect.any(String)
		);

		h.saveSettings.mockClear();
		const movedElsewhere = await POST({
			request: request({ kometaServerInstanceId: 'server-c' })
		} as Parameters<typeof POST>[0]);
		expect(movedElsewhere.status).toBe(409);
		expect(h.saveSettings).not.toHaveBeenCalled();
	});

	it('fails closed before every writer when the prior migration journal is unreadable', async () => {
		h.loadKometaMigrationJournal.mockRejectedValueOnce(new Error('journal authentication failed'));
		const response = await POST({
			request: request({
				kometaConfigMode: 'own',
				includedSections: ['movies'],
				ranking: validRanking
			})
		} as Parameters<typeof POST>[0]);

		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({
			error: { code: 'kometa_migration_config_locked' }
		});
		expect(h.saveSettings).not.toHaveBeenCalled();
		expect(h.setIncludedSectionsForServer).not.toHaveBeenCalled();
		expect(h.setArtworkRankingSettings).not.toHaveBeenCalled();
		expect(h.logEvent).not.toHaveBeenCalled();
	});

	it.each([
		['an assets directory hidden by a co-located config', { kometaAssetsDir: '/data/kometa-b' }],
		['a config mode with config sync disabled', { kometaConfigMode: 'own' }]
	])('allows %s without reading an unrelated unreadable journal', async (_label, update) => {
		if ('kometaConfigMode' in update) {
			h.resolveConfig.mockResolvedValue({
				kometaServerInstanceId: 'server-a',
				kometaAssetsDir: '/data/kometa-a',
				kometaConfigPath: '',
				kometaMetadataPathPrefix: 'config',
				kometaConfigMode: 'merge'
			});
		}
		h.loadKometaMigrationJournal.mockRejectedValue(new Error('journal authentication failed'));

		const response = await POST({ request: request(update) } as Parameters<typeof POST>[0]);

		expect(response.status).toBe(200);
		expect(h.loadKometaMigrationJournal).not.toHaveBeenCalled();
		expect(h.saveSettings).toHaveBeenCalledWith(update, expect.any(String));
	});

	it('observes a journal installed by concurrent confirmation before changing scope', async () => {
		let releaseConfirmation!: () => void;
		let confirmationEntered!: () => void;
		const entered = new Promise<void>((resolve) => {
			confirmationEntered = resolve;
		});
		const release = new Promise<void>((resolve) => {
			releaseConfirmation = resolve;
		});
		const confirmation = withKometaMigrationControlLock(async () => {
			confirmationEntered();
			await release;
			h.journals.set('server-a', migrationJournal('prepared'));
		});
		await entered;
		const settings = POST({
			request: request({ kometaServerInstanceId: 'server-b' })
		} as Parameters<typeof POST>[0]);
		releaseConfirmation();
		await confirmation;

		const response = await settings;
		expect(response.status).toBe(409);
		expect(h.loadKometaMigrationJournal).toHaveBeenCalledWith();
		expect(h.saveSettings).not.toHaveBeenCalled();
	});

	it('allows unchanged scope fields and changes after a terminal journal', async () => {
		h.journals.set('server-a', migrationJournal('writing_splits'));
		const unchanged = await POST({
			request: request({
				kometaServerInstanceId: 'server-a',
				kometaAssetsDir: '/data/kometa-a',
				kometaConfigPath: '/config/config.yml',
				kometaMetadataPathPrefix: 'config',
				kometaConfigMode: 'merge'
			})
		} as Parameters<typeof POST>[0]);
		expect(unchanged.status).toBe(200);

		for (const status of ['completed', 'rolled_back']) {
			h.journals.set('server-a', migrationJournal(status));
			const terminal = await POST({
				request: request({ kometaServerInstanceId: 'server-b' })
			} as Parameters<typeof POST>[0]);
			expect(terminal.status).toBe(200);
			expect(h.saveSettings).toHaveBeenLastCalledWith(
				{ kometaServerInstanceId: 'server-b' },
				expect.any(String)
			);
		}
	});

	it('forwards an explicit empty ThePosterDB password so the stored secret is cleared', async () => {
		const response = await POST({
			request: request({ thePosterDbPassword: '' })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
		// saveSettings deletes the settings row for empty values → password unset.
		expect(h.saveSettings).toHaveBeenCalledWith({ thePosterDbPassword: '' }, expect.any(String));
	});

	it('canonicalizes a safe Kometa-visible metadata prefix before saving', async () => {
		const response = await POST({
			request: request({ kometaMetadataPathPrefix: '.\\config\\metadata\\' })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
		expect(h.saveSettings).toHaveBeenCalledWith(
			{ kometaMetadataPathPrefix: 'config/metadata' },
			expect.any(String)
		);
	});

	it('preserves an explicit empty Kometa metadata prefix', async () => {
		const response = await POST({
			request: request({ kometaMetadataPathPrefix: '' })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
		expect(h.saveSettings).toHaveBeenCalledWith(
			{ kometaMetadataPathPrefix: '' },
			expect.any(String)
		);
	});

	it.each([
		['../escape', 'traversal'],
		['/absolute', 'absolute'],
		['config/posterpilot-movies.yml', 'filename']
	])('rejects unsafe Kometa metadata prefix %j', async (prefix, reason) => {
		const response = await POST({
			request: request({ kometaMetadataPathPrefix: prefix })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: { code: 'invalid_kometa_metadata_path_prefix', reason }
		});
		expect(h.saveSettings).not.toHaveBeenCalled();
	});

	it('persists the regular configuration and complete ranking together', async () => {
		const response = await POST({
			request: request({ defaultApplyMethod: 'plex', ranking: validRanking })
		} as Parameters<typeof POST>[0]);
		expect(response.status).toBe(200);
		expect(h.saveSettings).toHaveBeenCalledWith({ defaultApplyMethod: 'plex' }, expect.any(String));
		expect(h.setArtworkRankingSettings).toHaveBeenCalledWith(validRanking);
		expect(h.logEvent).toHaveBeenCalledWith('info', 'settings', 'Settings updated', {
			keys: ['defaultApplyMethod', 'artworkRanking']
		});
	});
});
