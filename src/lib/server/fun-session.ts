import { funSeedHash } from './fun-pick';

export interface SessionCandidate {
	id: number;
	runtime: number | null;
}

export type SessionPlanFailure =
	| 'invalid-budget'
	| 'not-enough-known-runtime'
	| 'no-combination-fits';

export type SessionPlan<T extends SessionCandidate> =
	| { ok: true; items: T[]; totalMinutes: number; remainingMinutes: number }
	| { ok: false; reason: SessionPlanFailure; eligibleCount: number };

interface Combination<T> {
	items: T[];
	total: number;
	tieRank: number;
}

function better<T>(candidate: Combination<T>, current: Combination<T> | null): boolean {
	if (!current) return true;
	return (
		candidate.total > current.total ||
		(candidate.total === current.total && candidate.tieRank < current.tieRank)
	);
}

/**
 * Fit exactly two or three distinct movies inside a duration budget. The chosen
 * combination maximizes used minutes; a stable seed decides ties, making re-plan
 * reproducible without ever duplicating an item.
 */
export function planDurationSession<T extends SessionCandidate>(
	candidates: readonly T[],
	budgetMinutes: number,
	filmCount: 2 | 3,
	seed: string
): SessionPlan<T> {
	if (!Number.isInteger(budgetMinutes) || budgetMinutes < 30 || budgetMinutes > 24 * 60) {
		return { ok: false, reason: 'invalid-budget', eligibleCount: 0 };
	}

	const eligible = candidates
		.filter(
			(item): item is T & { runtime: number } =>
				Number.isInteger(item.runtime) && (item.runtime as number) > 0
		)
		.sort((a, b) => a.runtime - b.runtime || a.id - b.id);
	if (eligible.length < filmCount) {
		return { ok: false, reason: 'not-enough-known-runtime', eligibleCount: eligible.length };
	}

	let winner: Combination<T> | null = null;
	const consider = (items: T[], total: number) => {
		if (total > budgetMinutes) return;
		const ids = items.map((item) => item.id).sort((a, b) => a - b);
		const candidate = { items, total, tieRank: funSeedHash(`${seed}:${ids.join(',')}`) };
		if (better(candidate, winner)) winner = candidate;
	};

	if (filmCount === 2) {
		let left = 0;
		let right = eligible.length - 1;
		while (left < right) {
			const total = eligible[left].runtime + eligible[right].runtime;
			if (total <= budgetMinutes) {
				consider([eligible[left], eligible[right]], total);
				left += 1;
			} else {
				right -= 1;
			}
		}
	} else {
		// O(n²) three-sum with a two-pointer inner pass. This stays practical for large
		// libraries while considering the best budget-filling combination exactly.
		for (let first = 0; first < eligible.length - 2; first += 1) {
			let left = first + 1;
			let right = eligible.length - 1;
			while (left < right) {
				const total = eligible[first].runtime + eligible[left].runtime + eligible[right].runtime;
				if (total <= budgetMinutes) {
					consider([eligible[first], eligible[left], eligible[right]], total);
					left += 1;
				} else {
					right -= 1;
				}
			}
		}
	}

	// TypeScript does not model mutation through the local `consider` closure, so
	// take an explicit snapshot after the search before narrowing it.
	const selected = winner as Combination<T> | null;
	if (!selected) {
		return { ok: false, reason: 'no-combination-fits', eligibleCount: eligible.length };
	}
	return {
		ok: true,
		items: selected.items,
		totalMinutes: selected.total,
		remainingMinutes: budgetMinutes - selected.total
	};
}
