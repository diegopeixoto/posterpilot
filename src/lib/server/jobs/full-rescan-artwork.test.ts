import { describe, expect, it, vi } from 'vitest';
import type { ServerArtwork } from '$lib/server/media-server';
import { sha256Bytes } from '$lib/server/revisions/verification';
import {
	classifyFullRescanArtworkObservation,
	createFullRescanArtworkObserver,
	fingerprintArtworkUrl,
	readFullRescanArtworkObservations,
	type FullRescanArtworkObserverOptions,
	type FullRescanArtworkStateRepository,
	type TrackedArtworkSlot
} from './full-rescan-artwork';

const OBSERVED_AT = new Date('2026-07-11T12:00:00.000Z');
const VERIFIED_AT = new Date('2026-07-10T12:00:00.000Z');

function tracked(
	kind: 'poster' | 'background',
	values: Partial<TrackedArtworkSlot> = {}
): TrackedArtworkSlot {
	return {
		kind,
		currentUrl: `https://server.example/items/1/${kind}?tag=old&api_key=secret-a`,
		currentFingerprint: sha256Bytes(new Uint8Array([1, 2, 3])),
		lastVerifiedAt: VERIFIED_AT,
		externalChangedAt: null,
		...values
	};
}

function artwork(
	kind: 'poster' | 'background',
	bytes: number[],
	url = `https://server.example/items/1/${kind}?tag=new&api_key=secret-b`
): ServerArtwork {
	return {
		kind,
		url,
		identity: `${kind}-new`,
		data: new Uint8Array(bytes).buffer,
		contentType: 'image/jpeg'
	};
}

describe('full rescan artwork identity', () => {
	it('redacts credential values before deriving URL identity', () => {
		const before = fingerprintArtworkUrl(
			'https://server.example/Items/1/Images/Primary?tag=same&api_key=secret-a'
		);
		const after = fingerprintArtworkUrl(
			'https://server.example/Items/1/Images/Primary?api_key=secret-b&tag=same'
		);
		expect(before).toBe(after);
		expect(before).not.toContain('secret-a');
		expect(before).not.toContain('secret-b');
	});

	it('classifies changed bytes after a verified apply as an exact external change', () => {
		const previous = tracked('poster');
		const nextFingerprint = sha256Bytes(new Uint8Array([9, 8, 7]));
		expect(
			classifyFullRescanArtworkObservation(previous, {
				kind: 'poster',
				url: 'https://server.example/items/1/poster?tag=new',
				fingerprint: nextFingerprint,
				evidence: 'bytes'
			})
		).toEqual({
			status: 'external_change',
			verification: 'exact',
			projectionFingerprint: nextFingerprint
		});
	});

	it('does not create external review work before a trusted verified baseline exists', () => {
		const previous = tracked('poster', { lastVerifiedAt: null, externalChangedAt: null });
		expect(
			classifyFullRescanArtworkObservation(previous, {
				kind: 'poster',
				url: 'https://server.example/items/1/poster?tag=new',
				fingerprint: sha256Bytes(new Uint8Array([9, 8, 7])),
				evidence: 'bytes'
			}).status
		).toBe('baseline');
	});

	it('does not mistake a rotated credential for an external artwork change', () => {
		const previous = tracked('poster', {
			currentUrl: 'https://server.example/Items/1/Images/Primary?tag=same&api_key=secret-a'
		});
		const observedUrl = 'https://server.example/Items/1/Images/Primary?api_key=secret-b&tag=same';
		expect(
			classifyFullRescanArtworkObservation(previous, {
				kind: 'poster',
				url: observedUrl,
				fingerprint: fingerprintArtworkUrl(observedUrl),
				evidence: 'url_identity'
			})
		).toMatchObject({
			status: 'unchanged',
			verification: 'best_effort',
			projectionFingerprint: previous.currentFingerprint
		});
	});

	it('upgrades a URL-only observation to bytes without reporting the same artwork twice', () => {
		const currentUrl = 'https://server.example/Items/1/Images/Primary?tag=same&api_key=secret-a';
		const previous = tracked('poster', {
			currentUrl,
			currentFingerprint: fingerprintArtworkUrl(currentUrl),
			externalChangedAt: VERIFIED_AT
		});
		const exactFingerprint = sha256Bytes(new Uint8Array([7, 7, 7]));
		expect(
			classifyFullRescanArtworkObservation(previous, {
				kind: 'poster',
				url: 'https://server.example/Items/1/Images/Primary?api_key=secret-b&tag=same',
				fingerprint: exactFingerprint,
				evidence: 'bytes'
			})
		).toEqual({
			status: 'unchanged',
			verification: 'best_effort',
			projectionFingerprint: exactFingerprint
		});
	});

	it('treats provider-confirmed removal of verified artwork as an external change', () => {
		expect(
			classifyFullRescanArtworkObservation(tracked('background'), {
				kind: 'background',
				url: null,
				fingerprint: null,
				evidence: 'provider_absence'
			})
		).toEqual({
			status: 'external_change',
			verification: 'exact',
			projectionFingerprint: null
		});
	});
});

describe('full rescan artwork reads', () => {
	it('reads poster and background independently and falls back only for the failed slot', async () => {
		const readArtwork = vi.fn(async (_id: string, kind: 'poster' | 'background') => {
			if (kind === 'background') throw new Error('temporary read failure');
			return artwork('poster', [4, 5, 6]);
		});
		const observations = await readFullRescanArtworkObservations({ readArtwork }, 'source-1', {
			poster: 'https://server.example/poster?tag=list',
			background: 'https://server.example/background?tag=list&api_key=secret'
		});

		expect(readArtwork).toHaveBeenCalledTimes(2);
		expect(observations).toEqual([
			{
				kind: 'poster',
				url: 'https://server.example/items/1/poster?tag=new',
				fingerprint: sha256Bytes(new Uint8Array([4, 5, 6])),
				evidence: 'bytes'
			},
			{
				kind: 'background',
				url: 'https://server.example/background?tag=list',
				fingerprint: fingerprintArtworkUrl(
					'https://server.example/background?tag=list&api_key=secret'
				),
				evidence: 'url_identity'
			}
		]);
	});
});

describe('full rescan external observation history', () => {
	it('appends only changed verified slots and updates other observed projections', async () => {
		const projections: Array<Record<string, unknown>> = [];
		const repository: FullRescanArtworkStateRepository = {
			loadRootSlots: vi.fn().mockResolvedValue([
				tracked('poster'),
				tracked('background', {
					currentFingerprint: null,
					currentUrl: null,
					lastVerifiedAt: null
				})
			]),
			updateProjection: vi.fn(async (input) => {
				projections.push(input);
			})
		};
		const recordOutcome = vi.fn().mockResolvedValue({});
		const ledger = {
			createGroup: vi.fn().mockResolvedValue({ id: 'external-group-1' }),
			recordOutcome,
			finalizeGroup: vi.fn().mockResolvedValue({})
		} as unknown as NonNullable<FullRescanArtworkObserverOptions['ledger']>;
		const server = {
			type: 'plex' as const,
			readArtwork: vi.fn(async (_id: string, kind: 'poster' | 'background') =>
				kind === 'poster' ? artwork('poster', [9, 8, 7]) : null
			)
		};
		const observe = createFullRescanArtworkObserver(repository, {
			ledger,
			clock: () => OBSERVED_AT
		});

		const result = await observe({
			server,
			serverInstanceId: 'server-a',
			mediaItemId: 41,
			sourceItemId: 'source-41',
			currentPosterUrl: 'https://server.example/poster?tag=new&token=secret',
			currentBackgroundUrl: null,
			previous: null,
			jobId: 17
		});

		expect(result).toEqual({ observedSlots: 2, externalChanges: 1, fallbackReads: 0 });
		expect(ledger.createGroup).toHaveBeenCalledWith({
			serverInstanceId: 'server-a',
			jobId: 17,
			kind: 'external_observation',
			initiator: 'full_rescan'
		});
		expect(ledger.recordOutcome).toHaveBeenCalledTimes(1);
		expect(ledger.recordOutcome).toHaveBeenCalledWith(
			expect.objectContaining({
				groupId: 'external-group-1',
				serverInstanceId: 'server-a',
				mediaItemId: 41,
				action: 'external_observation',
				destination: 'server',
				kind: 'poster',
				outcome: 'success',
				verification: 'exact',
				slotState: expect.objectContaining({
					advanceArtworkVersion: true,
					lastObservedAt: OBSERVED_AT,
					externalChangedAt: OBSERVED_AT
				})
			})
		);
		const recorded = recordOutcome.mock.calls[0]?.[0] as
			| {
					provenance?: unknown;
					priorFingerprint?: unknown;
					proposedFingerprint?: unknown;
			  }
			| undefined;
		// Current URLs remain an internal server projection; the append-only history
		// exposes only credential-free provenance and fingerprints.
		expect(
			JSON.stringify({
				provenance: recorded?.provenance,
				priorFingerprint: recorded?.priorFingerprint,
				proposedFingerprint: recorded?.proposedFingerprint
			})
		).not.toContain('secret');
		expect(projections).toEqual([
			expect.objectContaining({
				serverInstanceId: 'server-a',
				mediaItemId: 41,
				kind: 'background',
				currentUrl: null,
				currentFingerprint: null,
				observedAt: OBSERVED_AT
			})
		]);
		expect(ledger.finalizeGroup).toHaveBeenCalledWith({
			groupId: 'external-group-1',
			serverInstanceId: 'server-a',
			summary: { trigger: 'full_rescan', externalChanges: 1, observedSlots: 2 }
		});
	});

	it('creates no revision group for unchanged observations', async () => {
		const same = new Uint8Array([1, 2, 3]);
		const repository: FullRescanArtworkStateRepository = {
			loadRootSlots: vi
				.fn()
				.mockResolvedValue([
					tracked('poster'),
					tracked('background', { currentFingerprint: sha256Bytes(same) })
				]),
			updateProjection: vi.fn().mockResolvedValue(undefined)
		};
		const ledger = {
			createGroup: vi.fn(),
			recordOutcome: vi.fn(),
			finalizeGroup: vi.fn()
		} as unknown as NonNullable<FullRescanArtworkObserverOptions['ledger']>;
		const observe = createFullRescanArtworkObserver(repository, {
			ledger,
			clock: () => OBSERVED_AT
		});

		const result = await observe({
			server: {
				type: 'jellyfin',
				readArtwork: async (_id, kind) => artwork(kind, [1, 2, 3])
			},
			serverInstanceId: 'server-a',
			mediaItemId: 41,
			sourceItemId: 'source-41',
			currentPosterUrl: null,
			currentBackgroundUrl: null,
			previous: null
		});

		expect(result.externalChanges).toBe(0);
		expect(repository.updateProjection).toHaveBeenCalledTimes(2);
		expect(ledger.createGroup).not.toHaveBeenCalled();
		expect(ledger.recordOutcome).not.toHaveBeenCalled();
		expect(ledger.finalizeGroup).not.toHaveBeenCalled();
	});
});
