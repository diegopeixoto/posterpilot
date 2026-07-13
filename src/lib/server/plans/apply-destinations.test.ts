import { describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/config', () => ({ resolveConfig: vi.fn() }));

import { createApplyDestinationResolver } from './apply-destinations';
import type { ResolveApplyDestinationsInput } from './apply-planner';
import type { AppConfig } from '$lib/server/config';
import type { ApplyServerRegistry } from './apply-server-registry';

function input(serverInstanceId = 'server-a'): ResolveApplyDestinationsInput {
	const identity = {
		serverInstanceId,
		mediaItemId: 1,
		librarySectionKey: 'movies',
		sourceId: 'movie-1',
		type: 'movie' as const,
		tmdbId: '101',
		imdbId: null,
		tvdbId: null,
		mediaType: 'movie' as const,
		updatedAt: null,
		selectionUpdatedAt: null
	};
	const target = {
		item: {
			identity,
			ignored: false,
			sourceRemoved: false,
			discovery: { status: 'succeeded', runId: 'run-1', completedAt: null },
			currentSlots: []
		},
		candidates: [],
		storedSelections: []
	};
	return {
		context: { source: 'single' },
		target,
		selectionFrom: target,
		selections: [
			{
				selectionSource: 'stored',
				sourceItem: { serverInstanceId, mediaItemId: 1 },
				slot: { kind: 'poster', season: null, episode: null },
				candidateId: null,
				url: 'https://art.example/poster.jpg',
				provider: 'custom',
				providerAssetId: null,
				setId: null,
				setAuthor: null,
				designFamily: null,
				language: null,
				discoveryRunId: null,
				resolvedTmdbId: '101',
				resolvedMediaType: 'movie',
				stale: false,
				score: null,
				width: null,
				height: null,
				fingerprint: 'selection-fingerprint'
			}
		],
		destinations: ['kometa']
	};
}

function registry(type: 'plex' | 'jellyfin' = 'plex'): ApplyServerRegistry {
	return {
		resolve: vi.fn(async (serverInstanceId: string) => ({
			serverInstanceId,
			fingerprint: `fingerprint-${serverInstanceId}`,
			server: { type } as never
		}))
	};
}

function config(serverInstanceId: string): AppConfig {
	return { kometaServerInstanceId: serverInstanceId } as AppConfig;
}

describe('Kometa apply destination binding', () => {
	it('resolves Kometa only for the exact named Plex instance', async () => {
		const readKometaState = vi.fn(async () => ({
			targetId: 'kometa:101',
			current: {
				url: null,
				fingerprint: null,
				artworkVersion: null,
				observedAt: null,
				destinationFingerprint: 'kometa-state'
			}
		}));
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry('plex'),
			loadConfig: async () => config('server-a'),
			readKometaState
		});

		await expect(resolve(input('server-a'))).resolves.toMatchObject([
			{ destination: 'kometa', targetId: 'kometa:101', capability: 'supported' }
		]);
		expect(readKometaState).toHaveBeenCalledOnce();
	});

	it('rejects a different server scope before reading or writing Kometa state', async () => {
		const readKometaState = vi.fn();
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry('plex'),
			loadConfig: async () => config('server-b'),
			readKometaState
		});

		await expect(resolve(input('server-a'))).rejects.toMatchObject({ code: 'scope_mismatch' });
		expect(readKometaState).not.toHaveBeenCalled();
	});

	it('rejects a non-Plex instance even when its id matches the configured binding', async () => {
		const resolve = createApplyDestinationResolver({
			serverRegistry: registry('jellyfin'),
			loadConfig: async () => config('server-a'),
			readKometaState: vi.fn()
		});

		await expect(resolve(input('server-a'))).rejects.toMatchObject({ code: 'scope_mismatch' });
	});
});
