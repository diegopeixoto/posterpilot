import { describe, expect, it } from 'vitest';
import {
	AutomationDefinitionValidationError,
	freezeAutomationOccurrence,
	initialAutomationNextRun,
	normalizeFrozenAutomationOccurrencePayload,
	normalizeAutomationDefinition,
	type AutomationDefinitionInput
} from './model';

function input(): AutomationDefinitionInput {
	return {
		name: '  Nightly   review  ',
		enabled: true,
		serverInstanceId: 'server-a',
		timezone: 'America/Bahia',
		timing: { triggerType: 'daily' as const, localTime: '02:30' },
		libraryScopes: ['movies', 'movies', 'shows'],
		discoveryInputs: { providers: ['tmdb', 'mediux'] }
	};
}

describe('automation definition', () => {
	it('normalizes a review-first definition deterministically', () => {
		const result = normalizeAutomationDefinition(input());
		expect(result).toMatchObject({
			name: 'Nightly review',
			normalizedName: 'nightly review',
			action: 'sync_discover',
			libraryScopes: ['movies', 'shows'],
			discoveryInputs: { forceRefresh: false, providers: ['mediux', 'tmdb'] },
			failurePauseThreshold: 3,
			catchUpWindowMinutes: 60
		});
	});

	it('calculates the first enabled run and leaves event triggers without a timer', () => {
		const now = new Date('2026-07-10T12:00:00.000Z');
		expect(
			initialAutomationNextRun(normalizeAutomationDefinition(input()), now)?.toISOString()
		).toBe('2026-07-11T05:30:00.000Z');
		const event = normalizeAutomationDefinition({
			...input(),
			timing: { triggerType: 'event', eventType: 'new_items' }
		});
		expect(initialAutomationNextRun(event, now)).toBeNull();
	});

	it('freezes immutable review-only occurrence inputs with a stable fingerprint', () => {
		const definition = normalizeAutomationDefinition(input());
		const first = freezeAutomationOccurrence({
			automationId: 'automation-a',
			definition,
			logicalKey: 'daily:2026-07-11',
			scheduledFor: new Date('2026-07-11T05:30:00.000Z'),
			frozenAt: new Date('2026-07-10T12:00:00.000Z'),
			itemIds: [4, 2]
		});
		const second = freezeAutomationOccurrence({
			automationId: 'automation-a',
			definition,
			logicalKey: 'daily:2026-07-11',
			scheduledFor: new Date('2026-07-11T05:30:00.000Z'),
			frozenAt: new Date('2026-07-10T12:00:00.000Z'),
			itemIds: [2, 4]
		});
		expect(first).toEqual(second);
		expect(first).toMatchObject({
			type: 'review_automation',
			reviewOnly: true,
			action: 'sync_discover',
			serverInstanceId: 'server-a',
			itemIds: [2, 4]
		});
		expect(first).not.toHaveProperty('apply');
		expect(first.sourceFingerprint).toMatch(/^[a-f0-9]{64}$/);
		expect(normalizeFrozenAutomationOccurrencePayload(first)).toEqual(first);
		expect(() =>
			normalizeFrozenAutomationOccurrencePayload({ ...first, reviewOnly: false })
		).toThrow(AutomationDefinitionValidationError);
		expect(() =>
			normalizeFrozenAutomationOccurrencePayload({
				...first,
				libraryScopes: ['other']
			})
		).toThrow(AutomationDefinitionValidationError);
	});

	it('rejects unsafe or mutation-like definitions', () => {
		for (const candidate of [
			{ ...input(), name: '   ' },
			{ ...input(), serverInstanceId: '../other' },
			{ ...input(), action: 'apply' as never },
			{ ...input(), libraryScopes: [] },
			{ ...input(), timing: { triggerType: 'daily' as const, localTime: '24:00' } },
			{ ...input(), timezone: 'Bad/Zone' }
		]) {
			expect(() => normalizeAutomationDefinition(candidate as AutomationDefinitionInput)).toThrow(
				AutomationDefinitionValidationError
			);
		}
	});
});
