import { describe, expect, it } from 'vitest';
import {
	calculateRetryDelayMs,
	classifyJobFailure,
	describeJob,
	normalizeJobPayload,
	relateJobs,
	sanitizeJobErrorText,
	sanitizedResult
} from './policy';
import {
	freezeAutomationOccurrence,
	normalizeAutomationDefinition
} from '$lib/server/automation/model';
import type { JobPayload } from './types';

const OCCURRENCE_ID = `occ_${'a'.repeat(40)}`;

function automationOccurrence() {
	return freezeAutomationOccurrence({
		automationId: 'automation-a',
		definition: normalizeAutomationDefinition({
			name: 'Review',
			enabled: true,
			serverInstanceId: 'server-a',
			timezone: 'UTC',
			timing: { triggerType: 'interval', intervalMinutes: 60 },
			libraryScopes: ['movies']
		}),
		logicalKey: 'interval:2026-07-10T12:00:00.000Z',
		scheduledFor: new Date('2026-07-10T12:00:00.000Z'),
		frozenAt: new Date('2026-07-10T11:59:00.000Z'),
		itemIds: [4, 2]
	});
}

function crossServerApplyPayload(): JobPayload {
	return {
		kind: 'apply',
		planId: 'cross-plan',
		digest: 'a'.repeat(64),
		plan: {
			context: {
				source: 'cross_server',
				sourceItem: {
					serverInstanceId: 'source-server',
					mediaItemId: 11,
					librarySectionKey: 'source-library'
				}
			},
			scope: {
				serverInstanceIds: ['destination-server'],
				librarySectionKeys: ['destination-library'],
				targetItemIds: [22]
			},
			items: [{ operations: [] }]
		}
	} as unknown as JobPayload;
}

function undoPayload(
	slot: { kind: string; season: number | null; episode: number | null } = {
		kind: 'poster',
		season: null,
		episode: null
	},
	mediaItemId = 22
): JobPayload {
	return {
		kind: 'undo',
		planId: 'undo-plan',
		digest: 'b'.repeat(64),
		plan: {
			scope: { kind: 'item', serverInstanceId: 'destination-server', mediaItemId },
			operations: [
				{
					id: 'op-1',
					serverInstanceId: 'destination-server',
					target: { kind: 'item', mediaItemId },
					destination: 'server',
					slot
				}
			],
			summary: { operationCount: 1 }
		}
	} as unknown as JobPayload;
}

function applyPayloadForSlot(
	slot: { kind: string; season: number | null; episode: number | null } = {
		kind: 'poster',
		season: null,
		episode: null
	},
	mediaItemId = 22
): JobPayload {
	return {
		kind: 'apply',
		planId: 'apply-plan',
		digest: 'c'.repeat(64),
		plan: {
			context: { source: 'single' },
			scope: {
				serverInstanceIds: ['destination-server'],
				librarySectionKeys: ['destination-library'],
				targetItemIds: [mediaItemId]
			},
			items: [
				{
					target: { serverInstanceId: 'destination-server', mediaItemId },
					operations: [{ destination: 'server', slot }]
				}
			]
		}
	} as unknown as JobPayload;
}

describe('durable job policy', () => {
	it('clones and deterministically normalizes item scopes', () => {
		const source = {
			kind: 'discover' as const,
			serverInstanceId: ' server-a ',
			itemIds: [9, 2, 9],
			forceRefresh: false
		};
		const normalized = normalizeJobPayload(source);
		source.itemIds.push(100);
		expect(normalized).toEqual({
			kind: 'discover',
			serverInstanceId: 'server-a',
			itemIds: [2, 9]
		});
	});

	it('derives the same idempotency key for equivalent unordered requests', () => {
		const a = describeJob({ kind: 'discover', serverInstanceId: 's', itemIds: [7, 3] });
		const b = describeJob({ kind: 'discover', serverInstanceId: 's', itemIds: [3, 7] });
		expect(a.idempotencyKey).toBe(b.idempotencyKey);
		expect(relateJobs(a, b)).toBe('equivalent');
	});

	it('keeps different servers and disjoint item subsets independent', () => {
		const a = describeJob({ kind: 'discover', serverInstanceId: 'a', itemIds: [1] });
		const b = describeJob({ kind: 'discover', serverInstanceId: 'b', itemIds: [1] });
		const c = describeJob({ kind: 'discover', serverInstanceId: 'a', itemIds: [2] });
		expect(relateJobs(a, b)).toBe('independent');
		expect(relateJobs(a, c)).toBe('independent');
	});

	it('serializes overlapping sync/discover work', () => {
		const sync = describeJob({ kind: 'sync', serverInstanceId: 'a', full: true });
		const discover = describeJob({ kind: 'discover', serverInstanceId: 'a', itemIds: [2] });
		expect(sync.persistedType).toBe('full_rescan');
		expect(relateJobs(sync, discover)).toBe('conflict');
	});

	it('includes the frozen cross-server source in authorization and conflict scope', () => {
		const crossServer = describeJob(crossServerApplyPayload(), {
			persistedType: 'cross_server_apply'
		});
		expect(crossServer.scope).toMatchObject({
			serverInstanceIds: ['destination-server', 'source-server'],
			librarySectionKeys: ['destination-library', 'source-library'],
			itemIds: [11, 22]
		});
		expect(
			relateJobs(
				crossServer,
				describeJob({
					kind: 'discover',
					serverInstanceId: 'source-server',
					itemIds: [11]
				})
			)
		).toBe('conflict');
		expect(
			relateJobs(
				crossServer,
				describeJob({
					kind: 'sync',
					serverInstanceId: 'source-server',
					librarySectionKey: 'source-library'
				})
			)
		).toBe('conflict');
	});

	it('freezes automation identity and conflicts only with overlapping server-library work', () => {
		const automation = describeJob({
			kind: 'automation',
			occurrenceId: OCCURRENCE_ID,
			occurrence: automationOccurrence()
		});
		expect(automation).toMatchObject({
			persistedType: 'automation',
			safeToReplay: true,
			scope: {
				serverInstanceIds: ['server-a'],
				librarySectionKeys: ['movies'],
				itemIds: [2, 4]
			}
		});
		expect(
			relateJobs(
				automation,
				describeJob({ kind: 'discover', serverInstanceId: 'server-a', itemIds: [4] })
			)
		).toBe('conflict');
		expect(
			relateJobs(
				automation,
				describeJob({ kind: 'discover', serverInstanceId: 'server-b', itemIds: [4] })
			)
		).toBe('independent');
	});

	it('rejects any tampering that would turn review automation into mutation', () => {
		const occurrence = automationOccurrence();
		expect(() =>
			normalizeJobPayload({
				kind: 'automation',
				occurrenceId: OCCURRENCE_ID,
				occurrence: { ...occurrence, reviewOnly: false as true }
			})
		).toThrow('invalid_occurrence_payload');
	});

	it('calculates bounded exponential backoff with injectable jitter', () => {
		const policy = { baseDelayMs: 100, maxDelayMs: 450, jitterRatio: 0.2 };
		expect(calculateRetryDelayMs(1, policy, () => 0.5)).toBe(100);
		expect(calculateRetryDelayMs(3, policy, () => 0.5)).toBe(400);
		expect(calculateRetryDelayMs(10, policy, () => 1)).toBe(450);
	});

	it('classifies permanent configuration errors separately from transient failures', () => {
		expect(classifyJobFailure({ code: 'missing_credential', message: 'configure server' })).toEqual(
			expect.objectContaining({ retryable: false, recommendedAction: 'configure' })
		);
		expect(classifyJobFailure(new Error('provider network timeout'))).toEqual(
			expect.objectContaining({ retryable: true, recommendedAction: 'retry' })
		);
	});

	it('redacts credentials from persisted failure text', () => {
		const sanitized = sanitizeJobErrorText(
			'GET https://x.test/a?token=supersecret&x=1 Authorization: Bearer abc123 api_key=xyz'
		);
		expect(sanitized).not.toContain('supersecret');
		expect(sanitized).not.toContain('abc123');
		expect(sanitized).not.toContain('xyz');
		expect(sanitized).toContain('[redacted]');
	});

	it('redacts AWS credentials and encoded signature query keys from errors and results', () => {
		const accessKey = `AKIA${'B'.repeat(16)}`;
		const signature = 'deadbeefsecret';
		const sanitized = sanitizeJobErrorText(
			`GET https://provider.test/image?X%2DAmz%2DCredential=${accessKey}%2Fscope&X-Amz-Signature=${signature}&width=300 signature=${signature}`
		);
		const result = JSON.stringify(
			sanitizedResult({ error: sanitized, signature, safe: 'retained' })
		);
		expect(sanitized).not.toContain(accessKey);
		expect(sanitized).not.toContain(signature);
		expect(sanitized).toContain('width=300');
		expect(result).not.toContain(accessKey);
		expect(result).not.toContain(signature);
		expect(result).toContain('retained');
	});

	it('scopes an undo by the exact slots its frozen operations restore', () => {
		const undo = describeJob(undoPayload());
		expect(undo.persistedType).toBe('undo');
		expect(undo.mutating).toBe(true);
		expect(undo.scope).toMatchObject({
			serverInstanceIds: ['destination-server'],
			itemIds: [22],
			mutationKeys: ['destination-server:22:server:poster:root:root']
		});
	});

	it('serializes an undo against an apply that writes the same slot', () => {
		const undo = describeJob(undoPayload());
		const sameSlot = describeJob(applyPayloadForSlot());
		expect(relateJobs(undo, sameSlot)).toBe('conflict');

		// A different slot on the same item never touches the same destination artwork.
		const otherSlot = describeJob(
			applyPayloadForSlot({ kind: 'background', season: null, episode: null })
		);
		expect(relateJobs(undo, otherSlot)).toBe('independent');
	});

	it('never replays an undo as a safe retry', () => {
		const retried = describeJob(undoPayload(), { persistedType: 'retry' });
		expect(retried.safeToReplay).toBe(false);
	});

	it('serializes an undo against discovery that refreshes the same item', () => {
		expect(
			relateJobs(
				describeJob(undoPayload()),
				describeJob({ kind: 'discover', serverInstanceId: 'destination-server', itemIds: [22] })
			)
		).toBe('conflict');
	});
});
