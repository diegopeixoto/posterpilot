import type { ArtworkUndoExecutor } from '$lib/server/artwork-revisions/undo-executor';
import {
	confirmArtworkUndoPlan,
	createArtworkUndoPlanner,
	type ArtworkUndoPlannerDependencies,
	type ArtworkUndoPreview
} from '$lib/server/artwork-revisions/undo-planner';
import {
	assertUndoPlanPayload,
	UNDO_PLAN_KIND,
	type UndoPlanPayloadV1,
	type UndoPlanScope
} from '$lib/server/artwork-revisions/undo-plan';
import type { NativeArtworkPlanStore } from './native-artwork-service';

export type NativeCollectionUndoScope =
	| { kind: 'collection' }
	| { kind: 'revision'; revisionId: string }
	| { kind: 'group'; revisionGroupId: string }
	| { kind: 'slot'; slot: 'poster' | 'background' };

export interface PreviewNativeCollectionUndoInput {
	serverInstanceId: string;
	mediaCollectionId: string;
	scope?: NativeCollectionUndoScope;
}

export interface ConfirmNativeCollectionUndoInput {
	serverInstanceId: string;
	mediaCollectionId: string;
	planId: string;
	digest: string;
	initiator?: string;
}

export type NativeCollectionUndoErrorCode =
	| 'invalid_request'
	| 'native_collection_undo_scope_mismatch'
	| 'native_collection_undo_scope_not_found';

class NativeCollectionUndoError extends Error {
	constructor(readonly code: NativeCollectionUndoErrorCode) {
		super(code);
		this.name = 'NativeCollectionUndoError';
	}
}

export interface NativeCollectionUndoDependencies {
	plannerDependencies: ArtworkUndoPlannerDependencies;
	executor: ArtworkUndoExecutor;
	planStore: Pick<NativeArtworkPlanStore, 'validate'>;
	assertCollection(serverInstanceId: string, mediaCollectionId: string): Promise<void>;
	mutationsAllowed?: () => void;
}

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/;
const SHA256 = /^[a-f0-9]{64}$/;

function identifier(value: string): string {
	if (!SAFE_ID.test(value) || value.includes('..') || value.includes(':/')) {
		throw new NativeCollectionUndoError('invalid_request');
	}
	return value;
}

function scopeFor(
	serverInstanceId: string,
	mediaCollectionId: string,
	scope: NativeCollectionUndoScope
): UndoPlanScope {
	switch (scope.kind) {
		case 'collection':
			return {
				kind: 'destination',
				serverInstanceId,
				target: { kind: 'collection', mediaCollectionId },
				destination: 'server'
			};
		case 'slot':
			if (scope.slot !== 'poster' && scope.slot !== 'background') {
				throw new NativeCollectionUndoError('invalid_request');
			}
			return {
				kind: 'slot',
				serverInstanceId,
				target: { kind: 'collection', mediaCollectionId },
				slot: { kind: scope.slot, season: null, episode: null }
			};
		case 'revision':
			return {
				kind: 'revision',
				serverInstanceId,
				revisionId: identifier(scope.revisionId)
			};
		case 'group':
			return {
				kind: 'group',
				serverInstanceId,
				revisionGroupId: identifier(scope.revisionGroupId)
			};
	}
}

function payloadMatchesCollection(
	payload: UndoPlanPayloadV1,
	serverInstanceId: string,
	mediaCollectionId: string
): boolean {
	return (
		payload.scope.serverInstanceId === serverInstanceId &&
		payload.operations.length > 0 &&
		payload.operations.every(
			(operation) =>
				operation.serverInstanceId === serverInstanceId &&
				operation.target.kind === 'collection' &&
				operation.target.mediaCollectionId === mediaCollectionId &&
				operation.destination === 'server' &&
				operation.slot.season === null &&
				operation.slot.episode === null &&
				(operation.slot.kind === 'poster' || operation.slot.kind === 'background')
		)
	);
}

function previewMatchesCollection(
	preview: ArtworkUndoPreview,
	serverInstanceId: string,
	mediaCollectionId: string
): boolean {
	return (
		preview.operations.length > 0 &&
		preview.operations.every(
			(operation) =>
				operation.serverInstanceId === serverInstanceId &&
				operation.target.kind === 'collection' &&
				operation.target.mediaCollectionId === mediaCollectionId &&
				operation.destination === 'server' &&
				operation.slot.season === null &&
				operation.slot.episode === null &&
				(operation.slot.kind === 'poster' || operation.slot.kind === 'background')
		)
	);
}

/** Bind generic immutable undo to exactly one native collection authorization anchor. */
export function createNativeCollectionUndo(dependencies: NativeCollectionUndoDependencies) {
	const previewPlan = createArtworkUndoPlanner(dependencies.plannerDependencies);

	async function preview(input: PreviewNativeCollectionUndoInput) {
		dependencies.mutationsAllowed?.();
		const serverInstanceId = identifier(input.serverInstanceId);
		const mediaCollectionId = identifier(input.mediaCollectionId);
		await dependencies.assertCollection(serverInstanceId, mediaCollectionId);
		const result = await previewPlan({
			scope: scopeFor(serverInstanceId, mediaCollectionId, input.scope ?? { kind: 'collection' })
		});
		if (!previewMatchesCollection(result, serverInstanceId, mediaCollectionId)) {
			throw new NativeCollectionUndoError('native_collection_undo_scope_mismatch');
		}
		return result;
	}

	async function confirm(input: ConfirmNativeCollectionUndoInput) {
		dependencies.mutationsAllowed?.();
		const serverInstanceId = identifier(input.serverInstanceId);
		const mediaCollectionId = identifier(input.mediaCollectionId);
		const planId = identifier(input.planId);
		if (!SHA256.test(input.digest)) throw new NativeCollectionUndoError('invalid_request');
		await dependencies.assertCollection(serverInstanceId, mediaCollectionId);
		const inspected = await dependencies.planStore.validate<unknown>(planId, {
			kind: UNDO_PLAN_KIND,
			digest: input.digest,
			serverInstanceId
		});
		try {
			assertUndoPlanPayload(inspected.payload);
		} catch {
			throw new NativeCollectionUndoError('native_collection_undo_scope_mismatch');
		}
		if (!payloadMatchesCollection(inspected.payload, serverInstanceId, mediaCollectionId)) {
			throw new NativeCollectionUndoError('native_collection_undo_scope_mismatch');
		}
		const confirmed = await confirmArtworkUndoPlan(
			{ planId, digest: input.digest, serverInstanceId },
			dependencies.plannerDependencies
		);
		if (!payloadMatchesCollection(confirmed.payload, serverInstanceId, mediaCollectionId)) {
			throw new NativeCollectionUndoError('native_collection_undo_scope_mismatch');
		}
		return dependencies.executor({
			planId: confirmed.planId,
			digest: confirmed.digest,
			payload: confirmed.payload,
			initiator: input.initiator ?? 'user'
		});
	}

	return { preview, confirm };
}
