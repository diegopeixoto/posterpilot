import { describe, expect, it } from 'vitest';
import {
	buildRetryPayloads,
	latestRetryableFailures,
	type RetryOutcomeProjection
} from './retry-plan';
import { buildApplyPlanPayload } from '$lib/server/plans/apply-plan';
import { canonicalJsonDigest } from '$lib/server/plans/canonical-json';
import {
	freezeAutomationOccurrence,
	normalizeAutomationDefinition
} from '$lib/server/automation/model';

function outcome(
	id: number,
	mediaItemId: number,
	status: RetryOutcomeProjection['status'],
	retryable = status === 'failed'
): RetryOutcomeProjection {
	return {
		id,
		mediaItemId,
		destination: null,
		kind: null,
		season: null,
		episode: null,
		status,
		retryable,
		result: null
	};
}

describe('failed-only job retry planning', () => {
	it('uses only the latest outcome for each unit', () => {
		expect(
			latestRetryableFailures([
				outcome(1, 10, 'failed'),
				outcome(2, 10, 'success'),
				outcome(3, 20, 'failed'),
				outcome(4, 30, 'failed', false)
			]).map((row) => row.id)
		).toEqual([3]);
	});

	it('builds a cloned sync retry payload with failed item ids only', () => {
		const [retry] = buildRetryPayloads(
			9,
			{ kind: 'sync', serverInstanceId: 'server-a', full: true },
			[outcome(4, 30, 'failed'), outcome(3, 20, 'failed')],
			'2026-07-11T00:00:00.000Z'
		);
		expect(retry).toEqual({
			payload: {
				kind: 'sync',
				serverInstanceId: 'server-a',
				full: true,
				itemIds: [20, 30]
			},
			outcomeIds: [3, 4]
		});
	});

	it('does not broaden a discovery subset', () => {
		const [retry] = buildRetryPayloads(
			11,
			{ kind: 'discover', serverInstanceId: 's', itemIds: [1, 2, 3], forceRefresh: true },
			[outcome(7, 2, 'failed')],
			'2026-07-11T00:00:00.000Z'
		);
		expect(retry.payload).toEqual({
			kind: 'discover',
			serverInstanceId: 's',
			itemIds: [2],
			forceRefresh: true
		});
	});

	it('retries only failed items inside the same frozen automation occurrence', () => {
		const occurrence = freezeAutomationOccurrence({
			automationId: 'automation-a',
			definition: normalizeAutomationDefinition({
				name: 'Review',
				enabled: true,
				serverInstanceId: 'server-a',
				timezone: 'UTC',
				timing: { triggerType: 'interval', intervalMinutes: 60 },
				libraryScopes: ['movies']
			}),
			logicalKey: 'interval:2026-07-11T00:00:00.000Z',
			scheduledFor: new Date('2026-07-11T00:00:00.000Z'),
			frozenAt: new Date('2026-07-11T00:00:00.000Z')
		});
		const [retry] = buildRetryPayloads(
			12,
			{
				kind: 'automation',
				occurrenceId: `occ_${'a'.repeat(40)}`,
				occurrence
			},
			[outcome(8, 31, 'failed'), outcome(7, 22, 'failed')],
			'2026-07-11T00:10:00.000Z'
		);
		expect(retry.payload).toEqual({
			kind: 'automation',
			occurrenceId: `occ_${'a'.repeat(40)}`,
			occurrence,
			retryItemIds: [22, 31]
		});
		expect(retry.outcomeIds).toEqual([7, 8]);
	});

	it('retries only the failed apply destination and never repeats its successful sibling', () => {
		const target = {
			serverInstanceId: 's',
			mediaItemId: 42,
			librarySectionKey: 'movies',
			sourceId: 'source-42',
			type: 'movie' as const,
			tmdbId: '42',
			imdbId: null,
			tvdbId: null,
			mediaType: 'movie' as const,
			updatedAt: '2026-07-11T00:00:00.000Z',
			selectionUpdatedAt: '2026-07-11T00:00:00.000Z'
		};
		const selection = {
			selectionSource: 'stored' as const,
			sourceItem: { serverInstanceId: 's', mediaItemId: 42 },
			slot: { kind: 'poster' as const, season: null, episode: null },
			candidateId: null,
			url: 'https://art.example/poster.jpg',
			provider: null,
			providerAssetId: null,
			setId: null,
			setAuthor: null,
			designFamily: null,
			language: null,
			discoveryRunId: null,
			resolvedTmdbId: '42',
			resolvedMediaType: 'movie' as const,
			stale: false,
			score: null,
			width: null,
			height: null,
			fingerprint: 'selection-fingerprint'
		};
		const emptyCurrent = {
			url: null,
			fingerprint: null,
			artworkVersion: 0,
			observedAt: null,
			destinationFingerprint: 'empty'
		};
		const plan = buildApplyPlanPayload({
			plannedAt: '2026-07-11T00:00:00.000Z',
			context: { source: 'single' },
			defaults: {
				configuredMethod: 'both',
				effectiveMethod: 'both',
				methodSource: 'explicit',
				selectionMode: 'stored',
				scoring: {
					providerPriority: [],
					weights: { providerWeights: {}, resolutionWeight: 0, aspectWeight: 0 }
				}
			},
			items: [
				{
					target,
					selectionFrom: target,
					discovery: {
						status: 'succeeded',
						runId: null,
						completedAt: null,
						resolvedTmdbId: '42',
						resolvedMediaType: 'movie',
						candidateIds: [],
						candidateCount: 0,
						fingerprint: 'discovery'
					},
					selections: [selection],
					destinationSlots: [
						{
							destination: 'server',
							slot: selection.slot,
							targetId: 'source-42',
							capability: 'supported',
							current: emptyCurrent,
							skipCode: null,
							parameters: {}
						},
						{
							destination: 'kometa',
							slot: selection.slot,
							targetId: '42',
							capability: 'supported',
							current: emptyCurrent,
							skipCode: null,
							parameters: {}
						}
					],
					itemSkip: null
				}
			]
		});
		const serverOperation = plan.items[0].operations.find(
			(operation) => operation.destination === 'server'
		)!;
		const [retry] = buildRetryPayloads(
			88,
			{
				kind: 'apply',
				planId: 'original',
				digest: canonicalJsonDigest(plan).digest,
				plan
			},
			[
				{
					...outcome(90, 42, 'failed'),
					destination: 'server',
					kind: 'poster',
					result: { operationId: serverOperation.id }
				}
			],
			'2026-07-11T00:10:00.000Z'
		);
		expect(retry.payload.kind).toBe('apply');
		if (retry.payload.kind !== 'apply') throw new Error('expected apply retry');
		expect(retry.payload.plan.defaults.effectiveMethod).toBe('server');
		expect(retry.payload.plan.summary.operationCount).toBe(1);
		expect(retry.payload.plan.items[0].operations[0].destination).toBe('server');
		expect(canonicalJsonDigest(retry.payload.plan).digest).toBe(retry.payload.digest);
	});
});
