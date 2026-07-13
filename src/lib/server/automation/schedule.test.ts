import { describe, expect, it } from 'vitest';
import {
	AutomationScheduleValidationError,
	dueOccurrenceDecision,
	localDateKey,
	nextDailyRun,
	nextDailyRunAfterOccurrence,
	nextIntervalRun,
	resolveDailyWallTime,
	scheduleLogicalKey
} from './schedule';

describe('automation schedule calculation', () => {
	it('anchors interval occurrences instead of drifting with a late poll', () => {
		const anchor = new Date('2026-07-10T12:00:00.000Z');
		expect(nextIntervalRun(new Date('2026-07-10T12:31:00.000Z'), anchor, 15).toISOString()).toBe(
			'2026-07-10T12:45:00.000Z'
		);
		expect(nextIntervalRun(new Date('2026-07-10T11:00:00.000Z'), anchor, 15)).toEqual(anchor);
	});

	it('resolves a normal daily wall time in its IANA timezone', () => {
		const next = nextDailyRun(new Date('2026-07-10T10:00:00.000Z'), '09:30', 'America/Bahia');
		expect(next.toISOString()).toBe('2026-07-10T12:30:00.000Z');
		expect(localDateKey(next, 'America/Bahia')).toBe('2026-07-10');
	});

	it('moves a nonexistent spring-forward wall time to the first valid local minute', () => {
		const candidates = resolveDailyWallTime('2026-03-08', '02:30', 'America/New_York');
		expect(candidates.map((value) => value.toISOString())).toEqual(['2026-03-08T07:00:00.000Z']);
	});

	it('recognizes both fall-back instants but advances by logical local day', () => {
		const candidates = resolveDailyWallTime('2026-11-01', '01:30', 'America/New_York');
		expect(candidates.map((value) => value.toISOString())).toEqual([
			'2026-11-01T05:30:00.000Z',
			'2026-11-01T06:30:00.000Z'
		]);
		expect(
			nextDailyRunAfterOccurrence(candidates[0], '01:30', 'America/New_York').toISOString()
		).toBe('2026-11-02T06:30:00.000Z');
	});

	it('classifies bounded catch-up without replaying old missed work', () => {
		const due = new Date('2026-07-10T12:00:00.000Z');
		expect(dueOccurrenceDecision(due, new Date('2026-07-10T11:59:00.000Z'), 60)).toEqual({
			state: 'not_due',
			lagMs: 0
		});
		expect(dueOccurrenceDecision(due, new Date('2026-07-10T12:45:00.000Z'), 60).state).toBe('due');
		expect(dueOccurrenceDecision(due, new Date('2026-07-10T14:00:00.000Z'), 60).state).toBe(
			'missed'
		);
	});

	it('builds stable logical keys and coalesces a daily DST overlap', () => {
		const first = new Date('2026-11-01T05:30:00.000Z');
		const second = new Date('2026-11-01T06:30:00.000Z');
		expect(
			scheduleLogicalKey({
				scheduleId: 'schedule-a',
				triggerType: 'daily',
				scheduledFor: first,
				timezone: 'America/New_York'
			})
		).toBe(
			scheduleLogicalKey({
				scheduleId: 'schedule-a',
				triggerType: 'daily',
				scheduledFor: second,
				timezone: 'America/New_York'
			})
		);
		expect(
			scheduleLogicalKey({
				scheduleId: 'schedule-a',
				triggerType: 'event',
				scheduledFor: first,
				timezone: 'UTC',
				eventIdentity: 'server-a:new-item:42'
			})
		).toBe('event:server-a:new-item:42');
	});

	it('rejects invalid timezones, wall times, and intervals', () => {
		for (const call of [
			() => nextDailyRun(new Date(), '25:00', 'UTC'),
			() => nextDailyRun(new Date(), '12:00', 'Not/AZone'),
			() => nextIntervalRun(new Date(), new Date(), 1)
		]) {
			expect(call).toThrow(AutomationScheduleValidationError);
		}
	});
});
