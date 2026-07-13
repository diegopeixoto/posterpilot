import { APPLY_PLAN_KIND, type ApplyPlanPayloadV1, type FrozenApplyJobPayload } from './apply-plan';
import type { ApplyPlanPreview } from './apply-planner';
import {
	ApplyPlanValidationError,
	assertApplyPlanFresh,
	assertApplyPlanPayload,
	type ApplyPlanFreshnessResolverDependencies
} from './apply-plan-validation';
import {
	OperationPlanError,
	type OperationPlan,
	type OperationPlanExpectations
} from './operation-plan-store';
import { redactSensitiveArtworkUrl } from './apply-redaction';

export interface ExactApplyPreviewResponse extends ApplyPlanPayloadV1 {
	planId: string | null;
	digest: string | null;
	expiresAt: string | null;
}

/**
 * Browser-safe view containing every frozen per-item/per-slot decision. Secret-like
 * URL values are display-redacted; planId/digest always bind the untouched server copy.
 */
export function exactApplyPreviewResponse(preview: ApplyPlanPreview): ExactApplyPreviewResponse {
	const payload = structuredClone(preview.payload);
	for (const item of payload.items) {
		for (const selection of item.selections) {
			selection.url = redactSensitiveArtworkUrl(selection.url)!;
		}
		for (const destination of item.destinationSlots) {
			destination.current.url = redactSensitiveArtworkUrl(destination.current.url);
		}
		for (const operation of item.operations) {
			operation.current.url = redactSensitiveArtworkUrl(operation.current.url);
			operation.selection.url = redactSensitiveArtworkUrl(operation.selection.url)!;
		}
	}
	return {
		...payload,
		planId: preview.plan?.id ?? null,
		digest: preview.plan?.digest ?? null,
		expiresAt: preview.plan?.expiresAt.toISOString() ?? null
	};
}

export interface ConfirmApplyPlanRequest {
	planId: string;
	digest: string;
	/** The server scope inferred from the authenticated/active route context. */
	serverInstanceId?: string;
	/** Single-item routes additionally bind confirmation to their URL item id. */
	targetItemId?: number;
}

interface ApplyPlanLifecycleStore {
	validate<T>(id: string, expectations?: OperationPlanExpectations): Promise<OperationPlan<T>>;
	consume<T>(id: string, expectations?: OperationPlanExpectations): Promise<OperationPlan<T>>;
}

export interface ConfirmApplyPlanDependencies extends ApplyPlanFreshnessResolverDependencies {
	store: ApplyPlanLifecycleStore;
	enqueue(payload: FrozenApplyJobPayload): Promise<number>;
}

function lifecycleError(error: unknown, planId: string): never {
	if (error instanceof OperationPlanError) throw error;
	if (error instanceof ApplyPlanValidationError) {
		if (error.code === 'plan_scope_mismatch') {
			throw new OperationPlanError('plan_scope_mismatch', planId);
		}
		if (error.code === 'plan_stale') throw new OperationPlanError('plan_stale', planId);
		throw new OperationPlanError('plan_corrupt', planId);
	}
	throw error;
}

function expectations(request: ConfirmApplyPlanRequest): OperationPlanExpectations {
	return {
		kind: APPLY_PLAN_KIND,
		digest: request.digest,
		...(request.serverInstanceId !== undefined
			? { serverInstanceId: request.serverInstanceId }
			: {})
	};
}

/** Validate freshness, atomically consume once, then enqueue only the frozen payload. */
export async function confirmApplyPlan(
	request: ConfirmApplyPlanRequest,
	dependencies: ConfirmApplyPlanDependencies
): Promise<{ jobId: number; planId: string; digest: string }> {
	if (!request.planId || !/^[0-9a-f]{64}$/.test(request.digest)) {
		throw new OperationPlanError('plan_digest_mismatch', request.planId || 'unknown');
	}
	const expected = expectations(request);

	try {
		const pending = await dependencies.store.validate<ApplyPlanPayloadV1>(request.planId, expected);
		assertApplyPlanPayload(pending.payload);
		if (
			request.targetItemId !== undefined &&
			(pending.payload.scope.targetItemIds.length !== 1 ||
				pending.payload.scope.targetItemIds[0] !== request.targetItemId)
		) {
			throw new ApplyPlanValidationError(
				'plan_scope_mismatch',
				'Apply plan does not match the item route scope'
			);
		}
		await assertApplyPlanFresh(pending.payload, dependencies);
		const consumed = await dependencies.store.consume<ApplyPlanPayloadV1>(request.planId, expected);
		const jobId = await dependencies.enqueue({
			kind: 'apply',
			planId: consumed.id,
			digest: consumed.digest,
			plan: consumed.payload
		});
		return { jobId, planId: consumed.id, digest: consumed.digest };
	} catch (error) {
		lifecycleError(error, request.planId);
	}
}
