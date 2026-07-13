import { describe, expect, it } from 'vitest';
import { planDurationSession } from './fun-session';

const movies = [
	{ id: 1, runtime: 80 },
	{ id: 2, runtime: 95 },
	{ id: 3, runtime: 105 },
	{ id: 4, runtime: 120 },
	{ id: 5, runtime: null }
];

describe('planDurationSession', () => {
	it('chooses two distinct movies that best fill the budget', () => {
		const plan = planDurationSession(movies, 210, 2, 'night');
		expect(plan).toMatchObject({ ok: true, totalMinutes: 200, remainingMinutes: 10 });
		if (plan.ok) expect(new Set(plan.items.map((item) => item.id)).size).toBe(2);
	});

	it('chooses three distinct movies and reports their combined duration', () => {
		const plan = planDurationSession(movies, 305, 3, 'triple');
		expect(plan).toMatchObject({ ok: true, totalMinutes: 305, remainingMinutes: 0 });
		if (plan.ok) expect(new Set(plan.items.map((item) => item.id)).size).toBe(3);
	});

	it('ignores movies without known positive runtimes', () => {
		const plan = planDurationSession(
			[
				{ id: 1, runtime: null },
				{ id: 2, runtime: 0 },
				{ id: 3, runtime: 90 }
			],
			240,
			2,
			'known'
		);
		expect(plan).toEqual({ ok: false, reason: 'not-enough-known-runtime', eligibleCount: 1 });
	});

	it('explains when enough films exist but no combination fits', () => {
		expect(
			planDurationSession(
				[
					{ id: 1, runtime: 100 },
					{ id: 2, runtime: 110 }
				],
				90,
				2,
				'tight'
			)
		).toEqual({ ok: false, reason: 'no-combination-fits', eligibleCount: 2 });
	});

	it('rejects implausible budgets explicitly', () => {
		expect(planDurationSession(movies, 29, 2, 'bad')).toEqual({
			ok: false,
			reason: 'invalid-budget',
			eligibleCount: 0
		});
	});

	it('is deterministic for a seed when equal-duration combinations tie', () => {
		const tied = [
			{ id: 1, runtime: 90 },
			{ id: 2, runtime: 90 },
			{ id: 3, runtime: 90 },
			{ id: 4, runtime: 90 }
		];
		const first = planDurationSession(tied, 180, 2, 'same');
		const second = planDurationSession([...tied].reverse(), 180, 2, 'same');
		expect(first).toEqual(second);
	});
});
