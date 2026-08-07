export const MIGRATION_DISCLOSURE_BATCH_SIZE = 30;
export const ROLLBACK_DISCLOSURE_BATCH_SIZE = 40;

export interface DisclosureState {
	shown: number;
	remaining: number;
	next: number;
}

function boundedCount(value: number): number {
	return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

/** Keep progressive disclosure arithmetic bounded and deterministic for untrusted payload counts. */
export function disclosureState(
	currentLimit: number,
	total: number,
	batchSize: number
): DisclosureState {
	const boundedTotal = boundedCount(total);
	const boundedBatch = boundedCount(batchSize);
	const shown = Math.min(boundedCount(currentLimit), boundedTotal);
	const remaining = boundedTotal - shown;
	return {
		shown,
		remaining,
		next: Math.min(boundedBatch, remaining)
	};
}

/** Reveal one stable batch without ever exceeding the available inventory. */
export function nextDisclosureLimit(
	currentLimit: number,
	total: number,
	batchSize: number
): number {
	const state = disclosureState(currentLimit, total, batchSize);
	return state.shown + state.next;
}

/** These terminal plan identities cannot be confirmed again and should not trap the local UI. */
export function shouldDiscardFrozenPreview(code: string): boolean {
	return code === 'plan_expired' || code === 'plan_consumed';
}
