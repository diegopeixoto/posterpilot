import type { KometaItemInput, KometaSeasonInput } from '$lib/server/kometa/yaml';
import type { MediaServer } from '$lib/server/media-server';
import { canonicalJsonDigest } from './canonical-json';
import { type ApplyPlanItem, type ApplyPlanOperation, type ApplyPlanPayloadV1 } from './apply-plan';
import { assertApplyPlanPayload } from './apply-plan-validation';
import type { ApplyServerRegistry } from './apply-server-registry';
import { redactApplyErrorText } from './apply-redaction';

export interface ApplyOperationExecutionResult {
	operationId: string;
	destination: 'server' | 'kometa';
	targetId: string;
	slot: ApplyPlanOperation['slot'];
	status: 'success' | 'failed';
	verification?: 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
	errorCode?: string;
	observedFingerprint?: string | null;
	artworkVersion?: number;
	error?: string;
}

export interface ApplyOperationExecutionContext {
	/** Bound provider for server operations; absent when resolution itself failed. */
	server?: MediaServer;
	/**
	 * Cooperative cancellation guard for dependencies that await a final precondition
	 * before mutating. Implementations must recheck it at their commit boundary.
	 */
	isCancelled?(): boolean;
}

export interface ApplyItemExecutionResult {
	serverInstanceId: string;
	mediaItemId: number;
	operations: ApplyOperationExecutionResult[];
	skips: ApplyPlanItem['skips'];
}

export interface ApplyPlanExecutionResult {
	planId: string;
	digest: string;
	sourceFingerprint: string;
	crossServer?: {
		sourceItem: { serverInstanceId: string; mediaItemId: number };
		match: Extract<ApplyPlanPayloadV1['context'], { source: 'cross_server' }>['match'];
		resolutions: Extract<ApplyPlanPayloadV1['context'], { source: 'cross_server' }>['resolutions'];
	};
	summary: {
		itemCount: number;
		operationCount: number;
		succeeded: number;
		failed: number;
		skipped: number;
	};
	items: ApplyItemExecutionResult[];
}

export interface ApplyPlanExecutorDependencies {
	serverRegistry: ApplyServerRegistry;
	writeKometa(
		items: KometaItemInput[],
		operations?: ApplyPlanOperation[],
		isCancelled?: () => boolean
	): Promise<void>;
	prepareOperation?(
		operation: ApplyPlanOperation,
		context: ApplyOperationExecutionContext
	): Promise<void>;
	executeServerOperation?(
		operation: ApplyPlanOperation,
		context: ApplyOperationExecutionContext
	): Promise<void>;
	recordOutcome?(
		operation: ApplyPlanOperation,
		result: ApplyOperationExecutionResult,
		context: ApplyOperationExecutionContext
	): Promise<void | ApplyOperationExecutionResult>;
}

export interface ApplyPlanExecutionHooks {
	isCancelled?(): boolean;
	progress?(processed: number, item: ApplyPlanItem): Promise<void>;
}

/**
 * Count durable progress units using the same phases the executor reports:
 * one server phase per item, one phase per exact Kometa file, or one phase for
 * an item whose frozen plan contains skips only.
 */
export function countApplyPlanProgressUnits(payload: ApplyPlanPayloadV1): number {
	return payload.items.reduce((total, item) => {
		const hasServerPhase = item.operations.some((operation) => operation.destination === 'server');
		const kometaFilenames = new Set(
			item.operations.flatMap((operation) => {
				if (operation.destination !== 'kometa') return [];
				const filename = operation.kometaDestination?.filename;
				if (!filename) throw new TypeError('Kometa operation is missing its typed destination');
				return [filename];
			})
		);
		return total + Math.max(1, Number(hasServerPhase) + kometaFilenames.size);
	}, 0);
}

function errorMessage(error: unknown): string {
	return redactApplyErrorText(error instanceof Error ? error.message : String(error));
}

function kometaInput(item: ApplyPlanItem, operations: ApplyPlanOperation[]): KometaItemInput {
	const destination = operations[0]?.kometaDestination;
	if (
		!destination ||
		operations.some(
			(operation) =>
				operation.destination !== 'kometa' || operation.kometaDestination?.key !== destination.key
		)
	) {
		throw new TypeError('Kometa batch item is missing one exact typed destination');
	}
	const seasons = new Map<number, KometaSeasonInput>();
	const ensureSeason = (season: number): KometaSeasonInput => {
		let value = seasons.get(season);
		if (!value) {
			value = { season };
			seasons.set(season, value);
		}
		return value;
	};
	let posterUrl: string | null = null;
	let backgroundUrl: string | null = null;
	for (const operation of operations) {
		const { slot } = operation;
		if (slot.season === null) {
			if (slot.kind === 'poster') posterUrl = operation.selection.url;
			else if (slot.kind === 'background') backgroundUrl = operation.selection.url;
			continue;
		}
		const season = ensureSeason(slot.season);
		if (slot.kind === 'poster') season.posterUrl = operation.selection.url;
		else if (slot.kind === 'title_card' && slot.episode !== null) {
			(season.episodes ??= []).push({ episode: slot.episode, url: operation.selection.url });
		}
	}
	const orderedSeasons = [...seasons.values()].sort((a, b) => a.season - b.season);
	for (const season of orderedSeasons) {
		season.episodes?.sort((a, b) => a.episode - b.episode);
	}
	return {
		destination,
		// The title is readability-only in the YAML writer; sourceId is frozen and
		// avoids a database lookup during execution.
		title: item.target.sourceId,
		posterUrl,
		backgroundUrl,
		seasons: orderedSeasons
	};
}

async function record(
	dependencies: ApplyPlanExecutorDependencies,
	operation: ApplyPlanOperation,
	result: ApplyOperationExecutionResult,
	context: ApplyOperationExecutionContext = {}
): Promise<ApplyOperationExecutionResult> {
	try {
		return (await dependencies.recordOutcome?.(operation, result, context)) ?? result;
	} catch (error) {
		return {
			...result,
			status: 'failed',
			error: `Outcome record failed: ${errorMessage(error)}`
		};
	}
}

/** Execute only operations already present in the frozen payload. */
export async function executeFrozenApplyPlan(
	planId: string,
	digest: string,
	payload: ApplyPlanPayloadV1,
	dependencies: ApplyPlanExecutorDependencies,
	hooks: ApplyPlanExecutionHooks = {}
): Promise<ApplyPlanExecutionResult> {
	assertApplyPlanPayload(payload);
	if (canonicalJsonDigest(payload).digest !== digest) {
		throw new TypeError('Frozen apply payload does not match its digest');
	}
	const pendingItems: Array<{
		item: ApplyPlanItem;
		results: ApplyOperationExecutionResult[];
	}> = [];
	const kometaBatches = new Map<
		string,
		Array<{
			item: ApplyPlanItem;
			operations: ApplyPlanOperation[];
			results: ApplyOperationExecutionResult[];
		}>
	>();
	let processed = 0;
	const reportProgress = async (item: ApplyPlanItem): Promise<void> => {
		processed++;
		await hooks.progress?.(processed, item);
	};

	for (const item of payload.items) {
		if (hooks.isCancelled?.()) break;
		const results: ApplyOperationExecutionResult[] = [];
		pendingItems.push({ item, results });
		const serverOperations = item.operations.filter(
			(operation) => operation.destination === 'server'
		);
		const kometaOperations = item.operations.filter(
			(operation) => operation.destination === 'kometa'
		);

		if (serverOperations.length) {
			try {
				const binding = await dependencies.serverRegistry.resolve(item.target.serverInstanceId);
				if (binding.serverInstanceId !== item.target.serverInstanceId) {
					throw new Error('Server registry returned the wrong instance');
				}
				for (const operation of serverOperations) {
					const context: ApplyOperationExecutionContext = {
						server: binding.server,
						isCancelled: hooks.isCancelled
					};
					let result: ApplyOperationExecutionResult;
					try {
						if (hooks.isCancelled?.()) throw new Error('cancelled');
						await dependencies.prepareOperation?.(operation, context);
						if (hooks.isCancelled?.()) throw new Error('cancelled');
						if (dependencies.executeServerOperation) {
							await dependencies.executeServerOperation(operation, context);
						} else if (operation.slot.kind === 'background') {
							if (!binding.server.applyBackgroundUrl) {
								throw new Error('Target server does not support background artwork');
							}
							await binding.server.applyBackgroundUrl(operation.targetId, operation.selection.url);
						} else {
							await binding.server.applyPosterUrl(operation.targetId, operation.selection.url);
						}
						result = {
							operationId: operation.id,
							destination: operation.destination,
							targetId: operation.targetId,
							slot: operation.slot,
							status: 'success'
						};
					} catch (error) {
						result = {
							operationId: operation.id,
							destination: operation.destination,
							targetId: operation.targetId,
							slot: operation.slot,
							status: 'failed',
							error: errorMessage(error)
						};
					}
					result = await record(dependencies, operation, result, context);
					results.push(result);
				}
			} catch (error) {
				for (const operation of serverOperations) {
					const result: ApplyOperationExecutionResult = {
						operationId: operation.id,
						destination: operation.destination,
						targetId: operation.targetId,
						slot: operation.slot,
						status: 'failed',
						error: errorMessage(error)
					};
					results.push(await record(dependencies, operation, result));
				}
			}
			await reportProgress(item);
		}

		if (kometaOperations.length) {
			const byFilename = new Map<string, ApplyPlanOperation[]>();
			for (const operation of kometaOperations) {
				const filename = operation.kometaDestination?.filename;
				if (!filename) throw new TypeError('Kometa operation is missing its typed destination');
				const operations = byFilename.get(filename) ?? [];
				operations.push(operation);
				byFilename.set(filename, operations);
			}
			for (const [filename, operations] of byFilename) {
				const batch = kometaBatches.get(filename) ?? [];
				batch.push({ item, operations, results });
				kometaBatches.set(filename, batch);
			}
		}
		if (serverOperations.length === 0 && kometaOperations.length === 0) {
			await reportProgress(item);
		}
	}

	// One atomic, all-or-nothing writer call per exact metadata file. All operations
	// sharing a file observe the same pre-write state; if preparation, CAS, or the
	// write fails, every operation in that file fails without a partial file commit.
	// The other typed file remains an independent failure domain.
	for (const [, entries] of [...kometaBatches.entries()].sort(([left], [right]) =>
		left.localeCompare(right)
	)) {
		const operations = entries.flatMap((entry) => entry.operations);
		let error: unknown = null;
		try {
			for (const operation of operations) {
				if (hooks.isCancelled?.()) throw new Error('cancelled');
				await dependencies.prepareOperation?.(operation, {});
			}
			if (hooks.isCancelled?.()) throw new Error('cancelled');
			await dependencies.writeKometa(
				entries.map((entry) => kometaInput(entry.item, entry.operations)),
				operations,
				hooks.isCancelled
			);
		} catch (caught) {
			error = caught;
		}
		for (const entry of entries) {
			for (const operation of entry.operations) {
				const result: ApplyOperationExecutionResult = {
					operationId: operation.id,
					destination: operation.destination,
					targetId: operation.targetId,
					slot: operation.slot,
					status: error === null ? 'success' : 'failed',
					...(error === null ? {} : { error: errorMessage(error) })
				};
				entry.results.push(await record(dependencies, operation, result));
			}
			await reportProgress(entry.item);
		}
	}

	const items: ApplyItemExecutionResult[] = [];
	for (const { item, results } of pendingItems) {
		const resultByOperation = new Map(results.map((result) => [result.operationId, result]));
		items.push({
			serverInstanceId: item.target.serverInstanceId,
			mediaItemId: item.target.mediaItemId,
			operations: item.operations.map((operation) => resultByOperation.get(operation.id)!),
			skips: item.skips
		});
	}

	const operationResults = items.flatMap((item) => item.operations);
	const crossServer =
		payload.context.source === 'cross_server'
			? {
					sourceItem: {
						serverInstanceId: payload.context.sourceItem.serverInstanceId,
						mediaItemId: payload.context.sourceItem.mediaItemId
					},
					match: payload.context.match,
					resolutions: payload.context.resolutions
				}
			: null;
	return {
		planId,
		digest,
		sourceFingerprint: payload.sourceFingerprint,
		...(crossServer ? { crossServer } : {}),
		summary: {
			itemCount: items.length,
			operationCount: operationResults.length,
			succeeded: operationResults.filter((result) => result.status === 'success').length,
			failed: operationResults.filter((result) => result.status === 'failed').length,
			skipped:
				items.reduce((count, item) => count + item.skips.length, 0) +
				(crossServer
					? crossServer.resolutions.filter((resolution) => resolution.status !== 'matched').length
					: 0)
		},
		items
	};
}
