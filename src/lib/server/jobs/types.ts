import type { ApplyPlanExecutionResult } from '$lib/server/plans/apply-executor';
import type { FrozenApplyJobPayload } from '$lib/server/plans/apply-plan';
import type { FrozenUndoJobPayload } from '$lib/server/artwork-revisions/undo-plan';
import type { FrozenAutomationOccurrencePayload } from '$lib/server/automation/model';

/** Immutable inputs accepted by the durable worker. */
export type JobPayload =
	| {
			kind: 'sync';
			serverInstanceId: string;
			full?: boolean;
			librarySectionKey?: string;
			/** Present only for a failed-item retry. */
			itemIds?: number[];
	  }
	| {
			kind: 'discover';
			serverInstanceId: string;
			itemIds?: number[];
			forceRefresh?: boolean;
	  }
	| {
			kind: 'automation';
			occurrenceId: string;
			occurrence: FrozenAutomationOccurrencePayload;
			/** Present only for a failed-item retry of the same frozen occurrence. */
			retryItemIds?: number[];
	  }
	| FrozenApplyJobPayload
	| FrozenUndoJobPayload;

export type JobExecutionKind = JobPayload['kind'];
export type PersistedJobType =
	| 'sync'
	| 'full_rescan'
	| 'discover'
	| 'apply'
	| 'undo'
	| 'retry'
	| 'automation'
	| 'diagnostics'
	| 'backup'
	| 'restore'
	| 'collection_apply'
	| 'cross_server_apply';

export interface JobItemOutcomeInput {
	serverInstanceId: string;
	mediaItemId?: number | null;
	destination?: string | null;
	kind?: string | null;
	season?: number | null;
	episode?: number | null;
	status: 'success' | 'failed' | 'skipped' | 'interrupted';
	retryable?: boolean;
	result?: Record<string, unknown> | null;
	errorCode?: string | null;
	error?: unknown;
}

/** Helpers passed to a task. All writes are durable before the promise resolves. */
export interface JobContext {
	jobId: number;
	isCancelled(): boolean;
	setPhase(phase: string | null): Promise<void>;
	setTotal(total: number): Promise<void>;
	progress(processed: number, currentItem: string | null): Promise<void>;
	recordOutcome(outcome: JobItemOutcomeInput): Promise<void>;
}

export interface JobTaskResult {
	summary: {
		processed: number;
		succeeded: number;
		failed: number;
		skipped?: number;
		interrupted?: number;
	};
	/** Internal, locale-neutral events emitted only after a user-initiated sync. */
	automationEvents?: {
		librarySectionKeys: string[];
		/** Each new item with its library, so an event automation only sees its own scope. */
		newItems: Array<{ id: number; librarySectionKey: string }>;
	};
}

export type WorkerTaskResult = JobTaskResult | ApplyPlanExecutionResult;
