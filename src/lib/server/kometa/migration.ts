import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { db } from '$lib/server/db';
import { refreshCoverageAfter } from '$lib/server/coverage/refresh';
import {
	getCachedLibraries,
	getKometaLastApplied,
	getKometaManagedLibraries,
	resolveConfig,
	type AppConfig
} from '$lib/server/config';
import { logEvent } from '$lib/server/events';
import {
	OperationPlanError,
	operationPlanStore,
	type OperationPlan
} from '$lib/server/plans/operation-plan-store';
import { hashCanonicalJson } from '$lib/server/plans/canonical-json';
import {
	inspectKometaCollisionGuard,
	kometaOutputDirectory
} from '$lib/server/plans/apply-destinations';
import {
	canonicalConfigPath,
	createProtectedBackupAtBinding,
	freezeConfigPath,
	readBackupAtBinding,
	readConfig,
	readConfigAtBinding,
	recoverConfigQuarantineAtBinding,
	removeConfigAtomicAtBinding,
	withConfigLocks,
	writeConfigAtomicAtBinding,
	type ConfigPathBinding
} from './config-io';
import { LEGACY_FILENAME, MOVIE_FILENAME, SHOW_FILENAME } from './destination';
import { classifyKometaLegacyConfig } from './legacy-layout';
import {
	withKometaMigrationControlLock,
	type KometaMigrationControlLease
} from './migration-control-lock';
import {
	classifyLegacyEntries,
	compareCodeUnitStrings,
	parseLegacyMetadata,
	type LegacyEntryClassificationResult
} from './migration-classifier';
import {
	planKometaMigrationConfig,
	type AuthoritativeKometaLibrary,
	type KometaMigrationConfigPlan
} from './migration-config';
import {
	loadKometaMigrationEvidence,
	type KometaMigrationEvidenceDatabase
} from './migration-evidence';
import {
	acknowledgeManualKometaMigration,
	executeKometaMigration,
	KometaMigrationPhysicalTargetChangedError,
	rollbackKometaMigration,
	type KometaMigrationExecutorDependencies
} from './migration-executor';
import {
	createKometaMigrationJournal,
	isEffectlessKometaMigrationFailure,
	isKometaMigrationIncomplete,
	updateKometaMigrationJournal,
	type KometaMigrationJournalV1
} from './migration-journal';
import {
	KOMETA_MIGRATION_PLAN_KIND,
	assertKometaMigrationPlanPayload,
	kometaMigrationBaselineFingerprint,
	kometaManualSnippetFingerprint,
	type KometaMigrationAmbiguousDisplay,
	type KometaMigrationDisplay,
	type KometaMigrationPlanPayload
} from './migration-plan';
import {
	completeKometaMigrationJournal,
	loadActiveKometaMigrationJournal,
	loadKometaMigrationJournal,
	loadKometaMigrationJournalForGuard,
	KometaMigrationStoreError,
	prepareKometaMigrationJournal,
	rollbackKometaMigrationJournal,
	saveKometaMigrationJournal
} from './migration-store';
import {
	publicKometaMigrationState,
	kometaMigrationCollisionState,
	type PublicKometaMigrationState,
	type PublicKometaMigrationStateOptions
} from './migration-state';
import { buildSplitMigrationYaml } from './migration-yaml';
import { kometaFileFingerprint, rawKometaChanges } from './plan';
import {
	findPhysicalPathAliasConflict,
	inspectFrozenPhysicalPath,
	PhysicalPathInspectionError
} from './physical-path-alias';
import { kometaMetadataReference } from './reference-path';
import { assertNoPendingKometaConfigMutationWhileOwned } from './config-mutation-recovery';
import {
	kometaBindingErrorCode,
	resolveKometaServerBinding,
	type KometaServerBinding
} from './server-binding';

const ROLLBACK_PLAN_KIND = 'kometa_split_migration_rollback' as const;
const ROLLBACK_PLAN_VERSION = 2 as const;
const SHA256 = /^[0-9a-f]{64}$/;
const MISSING_FILE_FINGERPRINT = kometaFileFingerprint(null);

export type KometaMigrationServiceErrorCode =
	| 'kometa_migration_not_required'
	| 'kometa_migration_in_progress'
	| 'kometa_migration_not_found'
	| 'kometa_migration_scope_changed'
	| 'kometa_migration_ambiguous_confirmation_required'
	| 'kometa_migration_config_incompatible'
	| 'kometa_migration_manual_ack_mismatch'
	| 'kometa_migration_abandon_unavailable'
	| 'kometa_migration_path_conflict'
	| 'kometa_migration_rollback_unavailable'
	| 'kometa_config_recovery_required'
	| 'kometa_server_binding_missing'
	| 'kometa_server_binding_incompatible'
	| 'kometa_server_binding_unavailable';

export class KometaMigrationServiceError extends Error {
	constructor(readonly code: KometaMigrationServiceErrorCode) {
		super(code);
		this.name = 'KometaMigrationServiceError';
	}
}

async function assertConfigCommitRecoveryIdle(
	assertControlLockOwned: () => Promise<KometaMigrationControlLease>
): Promise<void> {
	try {
		await assertNoPendingKometaConfigMutationWhileOwned(assertControlLockOwned);
	} catch {
		throw new KometaMigrationServiceError('kometa_config_recovery_required');
	}
}

export interface KometaMigrationPreview {
	required: true;
	planId: string;
	digest: string;
	expiresAt: string;
	migrationId: string;
	activation: 'managed' | 'manual';
	display: KometaMigrationDisplay;
	manualSnippet: string | null;
	manualSnippetFingerprint: string | null;
	fingerprints: {
		legacy: string;
		evidence: string;
		movieSource: string;
		movieProposed: string;
		showSource: string;
		showProposed: string;
		configSource: string | null;
		configProposed: string | null;
	};
}

export interface ConfirmKometaMigrationRequest {
	planId: string;
	digest: string;
	acceptAmbiguous?: boolean;
}

export interface CancelKometaMigrationPreviewRequest {
	planId: string;
	digest: string;
}

export interface ResumeKometaMigrationRequest {
	migrationId: string;
}

export interface AcknowledgeKometaMigrationRequest {
	migrationId: string;
	manualSnippetFingerprint: string;
}

export interface AbandonKometaMigrationRequest {
	migrationId: string;
}

export interface KometaMigrationRollbackPreview {
	planId: string;
	digest: string;
	expiresAt: string;
	migrationId: string;
	changes: ReturnType<typeof rawKometaChanges>['changes'];
	warnings: string[];
}

interface RollbackPlanPayload {
	type: typeof ROLLBACK_PLAN_KIND;
	version: typeof ROLLBACK_PLAN_VERSION;
	migrationId: string;
	serverInstanceId: string;
	configPath: string;
	currentFingerprint: string;
	backupName: string | null;
	backupChecksum: string | null;
	backupContentFingerprint: string;
	baselineFingerprint: string;
	display: {
		changes: ReturnType<typeof rawKometaChanges>['changes'];
		warnings: string[];
	};
}

function migrationBindingEntries(
	payload: KometaMigrationPlanPayload
): Array<readonly [string, ConfigPathBinding]> {
	return [
		[payload.legacy.path, payload.pathBindings.legacy],
		[payload.files.movie.path, payload.pathBindings.movie],
		[payload.files.show.path, payload.pathBindings.show],
		...(payload.config.path && payload.pathBindings.config
			? ([[payload.config.path, payload.pathBindings.config]] as const)
			: [])
	];
}

function assertFrozenMigrationBindings(payload: KometaMigrationPlanPayload): void {
	try {
		const entries = migrationBindingEntries(payload);
		for (const [index, [path, binding]] of entries.entries()) {
			const inspected = inspectFrozenPhysicalPath(binding, index);
			if (inspected.canonicalPath !== path) {
				throw new Error('Frozen migration path changed');
			}
		}
		if (findPhysicalPathAliasConflict(entries.map(([path]) => path)) !== null) {
			throw new Error('Frozen migration paths overlap');
		}
	} catch {
		throw new KometaMigrationServiceError('kometa_migration_path_conflict');
	}
}

function executorDependencies(
	payload: KometaMigrationPlanPayload,
	controlLease?: KometaMigrationControlLease,
	assertControlLockOwned?: () => Promise<KometaMigrationControlLease>
): KometaMigrationExecutorDependencies {
	const isPhysicalTargetChange = (error: unknown): boolean =>
		error instanceof PhysicalPathInspectionError && error.code !== 'inspection_failed';
	const entries = migrationBindingEntries(payload);
	const bindings = new Map(entries);
	const requireBinding = (path: string): ConfigPathBinding => {
		const binding = bindings.get(path);
		if (!binding) throw new KometaMigrationServiceError('kometa_migration_path_conflict');
		return binding;
	};
	return {
		read: (path) => readConfigAtBinding(requireBinding(path)),
		// Never reuse request-start evidence here: every callback runs while the
		// executor still owns the frozen filesystem locks.
		assertEvidenceCurrent: () => currentMigrationEvidenceState(payload),
		write: (path, content, stamp, expectedSource) => {
			try {
				writeConfigAtomicAtBinding(requireBinding(path), content, stamp, { expectedSource });
			} catch (error) {
				if (isPhysicalTargetChange(error)) {
					throw new KometaMigrationPhysicalTargetChangedError();
				}
				throw error;
			}
		},
		remove: (path, expectedContent) => {
			try {
				removeConfigAtomicAtBinding(requireBinding(path), expectedContent);
			} catch (error) {
				if (isPhysicalTargetChange(error)) {
					throw new KometaMigrationPhysicalTargetChangedError();
				}
				throw error;
			}
		},
		createProtectedBackup: (path, migrationId, expectedContent) => {
			const backup = createProtectedBackupAtBinding(requireBinding(path), migrationId, {
				expectedContent
			});
			return { name: backup.name, checksum: backup.checksum };
		},
		readProtectedBackup: (path, name, checksum) =>
			readBackupAtBinding(requireBinding(path), name, { expectedChecksum: checksum }),
		assertDistinctPaths: (paths) => {
			if (
				paths.length !== entries.length ||
				paths.some((path, index) => path !== entries[index][0])
			) {
				throw new KometaMigrationServiceError('kometa_migration_path_conflict');
			}
			assertFrozenMigrationBindings(payload);
		},
		assertCommitOwned: assertControlLockOwned
			? async () => {
					await assertControlLockOwned();
				}
			: undefined,
		saveJournal: (journal, expectedJournal) =>
			saveKometaMigrationJournal(journal, expectedJournal, controlLease),
		completeJournal: (journal, snapshot, expectedJournal) =>
			completeKometaMigrationJournal(
				journal,
				snapshot,
				expectedJournal,
				(database) => currentMigrationEvidenceState(payload, database),
				controlLease
			),
		rollbackJournal: (journal, snapshot, expectedJournal) =>
			rollbackKometaMigrationJournal(journal, snapshot, expectedJournal, controlLease),
		now: () => new Date()
	};
}

function jsonSafe<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function migrationPaths(payload: KometaMigrationPlanPayload): string[] {
	return [
		payload.legacy.path,
		payload.files.movie.path,
		payload.files.show.path,
		...(payload.config.path ? [payload.config.path] : [])
	];
}

function assertDistinctMigrationPaths(paths: readonly string[]): void {
	try {
		if (findPhysicalPathAliasConflict(paths) !== null) {
			throw new KometaMigrationServiceError('kometa_migration_path_conflict');
		}
	} catch (error) {
		if (error instanceof KometaMigrationServiceError) throw error;
		throw new KometaMigrationServiceError('kometa_migration_path_conflict');
	}
}

function requireDigest(request: { planId: string; digest: string }): void {
	if (!request.planId || !SHA256.test(request.digest)) {
		throw new OperationPlanError('plan_digest_mismatch', request.planId || 'unknown');
	}
}

async function validateMigrationPlan(
	request: ConfirmKometaMigrationRequest
): Promise<OperationPlan<KometaMigrationPlanPayload>> {
	requireDigest(request);
	const plan = await operationPlanStore.validate<KometaMigrationPlanPayload>(request.planId, {
		kind: KOMETA_MIGRATION_PLAN_KIND,
		digest: request.digest
	});
	try {
		assertKometaMigrationPlanPayload(plan.payload);
	} catch {
		throw new OperationPlanError('plan_corrupt', request.planId);
	}
	return plan;
}

/** Load a cancellation target without requiring freshness; an expired preview is already inert. */
async function loadMigrationPlanForCancellation(
	request: CancelKometaMigrationPreviewRequest
): Promise<OperationPlan<KometaMigrationPlanPayload>> {
	requireDigest(request);
	const plan = await operationPlanStore.load<KometaMigrationPlanPayload>(request.planId);
	if (!plan) throw new OperationPlanError('plan_not_found', request.planId);
	if (plan.kind !== KOMETA_MIGRATION_PLAN_KIND) {
		throw new OperationPlanError('plan_kind_mismatch', request.planId);
	}
	if (plan.digest !== request.digest) {
		throw new OperationPlanError('plan_digest_mismatch', request.planId);
	}
	if (plan.consumedAt !== null) throw new OperationPlanError('plan_consumed', request.planId);
	try {
		assertKometaMigrationPlanPayload(plan.payload);
	} catch {
		throw new OperationPlanError('plan_corrupt', request.planId);
	}
	return plan;
}

function currentFileMatchesSource(payload: KometaMigrationPlanPayload): boolean {
	try {
		if (
			kometaFileFingerprint(readConfigAtBinding(payload.pathBindings.legacy)) !==
			payload.legacy.sourceFingerprint
		) {
			return false;
		}
		if (
			kometaFileFingerprint(readConfigAtBinding(payload.pathBindings.movie)) !==
			payload.files.movie.sourceFingerprint
		) {
			return false;
		}
		if (
			kometaFileFingerprint(readConfigAtBinding(payload.pathBindings.show)) !==
			payload.files.show.sourceFingerprint
		) {
			return false;
		}
		if (
			payload.config.path &&
			payload.pathBindings.config &&
			kometaFileFingerprint(readConfigAtBinding(payload.pathBindings.config)) !==
				payload.config.sourceFingerprint
		) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

async function resolveBoundScope(): Promise<{
	config: AppConfig;
	binding: KometaServerBinding;
}> {
	const config = await resolveConfig();
	const resolvedBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	if (!resolvedBinding.binding) {
		throw new KometaMigrationServiceError(
			kometaBindingErrorCode(
				resolvedBinding.status as Exclude<typeof resolvedBinding.status, 'ready'>
			) as KometaMigrationServiceErrorCode
		);
	}
	return { config, binding: resolvedBinding.binding };
}

function samePath(left: string, right: string): boolean {
	return canonicalConfigPath(left) === canonicalConfigPath(right);
}

function snapshotScope(config: AppConfig, binding: KometaServerBinding) {
	return {
		serverInstanceId: binding.id,
		configPath: config.kometaConfigPath ? canonicalConfigPath(config.kometaConfigPath) : null,
		outputDirectory: canonicalConfigPath(kometaOutputDirectory(config)),
		metadataPathPrefix: config.kometaMetadataPathPrefix
	};
}

function frozenSnapshotScope(payload: KometaMigrationPlanPayload) {
	return {
		serverInstanceId: payload.serverInstanceId,
		configPath: payload.config.path,
		outputDirectory: payload.outputDirectory,
		metadataPathPrefix: payload.metadataPathPrefix
	};
}

function assertFrozenScope(
	config: AppConfig,
	binding: KometaServerBinding,
	payload: KometaMigrationPlanPayload
): void {
	if (
		config.kometaServerInstanceId !== payload.serverInstanceId ||
		binding.id !== payload.serverInstanceId ||
		!samePath(resolve(kometaOutputDirectory(config)), payload.outputDirectory) ||
		config.kometaMetadataPathPrefix !== payload.metadataPathPrefix ||
		Boolean(config.kometaConfigPath) !== Boolean(payload.config.path) ||
		(payload.config.path !== null &&
			(!samePath(resolve(config.kometaConfigPath), payload.config.path) ||
				config.kometaConfigMode !== payload.config.mode))
	) {
		throw new KometaMigrationServiceError('kometa_migration_scope_changed');
	}
}

function frozenScopeMatches(
	config: AppConfig,
	binding: KometaServerBinding,
	payload: KometaMigrationPlanPayload
): boolean {
	try {
		assertFrozenScope(config, binding, payload);
		return true;
	} catch {
		return false;
	}
}

function hasActiveLegacyReference(config: AppConfig): boolean {
	if (!config.kometaConfigPath) return false;
	const raw = readConfig(config.kometaConfigPath);
	return raw !== null && classifyKometaLegacyConfig(raw).references.length > 0;
}

function assertCompletedMigrationCanRestart(
	existing: Awaited<ReturnType<typeof loadKometaMigrationJournal>>,
	config: AppConfig,
	binding: KometaServerBinding
): void {
	if (
		existing?.status === 'completed' &&
		frozenScopeMatches(config, binding, existing.payload) &&
		!hasActiveLegacyReference(config)
	) {
		const guard = inspectKometaCollisionGuard(config, kometaMigrationCollisionState(existing));
		if (guard.reason !== 'unknown_config_with_legacy_file') {
			throw new KometaMigrationServiceError('kometa_migration_not_required');
		}
	}
}

function assertExistingMigrationCanStartFreshPreview(
	existing: KometaMigrationJournalV1 | null,
	config: AppConfig,
	binding: KometaServerBinding
): void {
	if (existing && isKometaMigrationIncomplete(existing)) {
		if (existing.status !== 'abandoned' && !isEffectlessKometaMigrationFailure(existing)) {
			throw new KometaMigrationServiceError('kometa_migration_in_progress');
		}
		assertFrozenScope(config, binding, existing.payload);
	}
	assertCompletedMigrationCanRestart(existing, config, binding);
}

function assertCancelledPlanIdentity(
	plan: OperationPlan<unknown>,
	kind: string,
	request: CancelKometaMigrationPreviewRequest,
	serverInstanceId: string
): void {
	if (plan.kind !== kind) throw new OperationPlanError('plan_kind_mismatch', request.planId);
	if (plan.digest !== request.digest) {
		throw new OperationPlanError('plan_digest_mismatch', request.planId);
	}
	if (plan.serverInstanceId !== serverInstanceId) {
		throw new OperationPlanError('plan_scope_mismatch', request.planId);
	}
}

async function cancelKometaOperationPreview(
	kind: string,
	request: CancelKometaMigrationPreviewRequest,
	serverInstanceId: string
): Promise<{ cancelled: true }> {
	requireDigest(request);
	const expectations = {
		kind,
		digest: request.digest,
		serverInstanceId
	};
	try {
		await operationPlanStore.consume(request.planId, expectations);
	} catch (error) {
		if (!(error instanceof OperationPlanError) || error.code !== 'plan_expired') {
			throw error;
		}
		const plan = await operationPlanStore.load(request.planId);
		if (!plan) throw new OperationPlanError('plan_not_found', request.planId);
		assertCancelledPlanIdentity(plan, kind, request, serverInstanceId);
		if (plan.consumedAt !== null || plan.expiresAt.getTime() > Date.now()) throw error;
	}
	return { cancelled: true };
}

function scopedAuthoritativeLibraries(input: {
	cached: { key: string; title: string; type: string }[];
	managedKeys: string[];
	snapshotLibraries: string[];
	legacyConfigLibraries: string[];
}): AuthoritativeKometaLibrary[] {
	const titles = new Set([...input.snapshotLibraries, ...input.legacyConfigLibraries]);
	const managed = new Set(input.managedKeys);
	for (const library of input.cached) if (managed.has(library.key)) titles.add(library.title);
	return input.cached
		.filter((library) => titles.has(library.title))
		.map((library) => ({ title: library.title, type: library.type }));
}

function combinedEvidenceFingerprint(
	classification: LegacyEntryClassificationResult,
	libraries: readonly AuthoritativeKometaLibrary[],
	baselineFingerprint: string
): string {
	return hashCanonicalJson({
		classification: classification.evidenceFingerprint,
		baseline: baselineFingerprint,
		libraries: [...libraries]
			.map((library) => ({ title: library.title, type: library.type }))
			.sort(
				(left, right) =>
					compareCodeUnitStrings(left.title, right.title) ||
					compareCodeUnitStrings(left.type, right.type)
			)
	});
}

function configTarget(
	config: AppConfig,
	activePath: string | null,
	rawConfig: string | null,
	configPlan: KometaMigrationConfigPlan
): KometaMigrationPlanPayload['config'] {
	if (
		activePath &&
		rawConfig !== null &&
		configPlan.activation === 'managed' &&
		configPlan.proposedContent !== null &&
		configPlan.proposedFingerprint !== null
	) {
		return {
			activation: 'managed',
			path: activePath,
			mode: config.kometaConfigMode,
			sourceFingerprint: kometaFileFingerprint(rawConfig),
			proposedFingerprint: configPlan.proposedFingerprint,
			proposedContent: configPlan.proposedContent
		};
	}
	return {
		activation: 'manual',
		path: activePath,
		mode: activePath ? config.kometaConfigMode : null,
		sourceFingerprint: activePath ? kometaFileFingerprint(rawConfig) : null,
		proposedFingerprint: null,
		proposedContent: null
	};
}

function assertMigrationConfigActionable(configPlan: KometaMigrationConfigPlan): void {
	if (!configPlan.manualWiringActionable) {
		throw new KometaMigrationServiceError('kometa_migration_config_incompatible');
	}
}

function conflictDisplays(
	classification: LegacyEntryClassificationResult,
	conflicts: ReturnType<typeof buildSplitMigrationYaml>['conflicts']
): KometaMigrationAmbiguousDisplay[] {
	const bySourceIndex = new Map(
		classification.classified.map((entry) => [entry.sourceIndex, entry])
	);
	return conflicts.flatMap((conflict) =>
		conflict.sourceIndexes.map((sourceIndex) => {
			const classified = bySourceIndex.get(sourceIndex);
			if (!classified) {
				throw new TypeError('Typed-target conflict references an unclassified legacy entry');
			}
			return {
				legacyKey: classified.legacyMappingId,
				entryFingerprint: classified.entryFingerprint,
				slots: classified.slots,
				reason: 'typed_target_conflict' as const
			};
		})
	);
}

function migrationDisplay(input: {
	classification: LegacyEntryClassificationResult;
	built: ReturnType<typeof buildSplitMigrationYaml>;
	configPlan: KometaMigrationConfigPlan;
	moviePath: string;
	showPath: string;
	references: { movie: string; show: string };
}): KometaMigrationDisplay {
	const conflictSourceIndexes = new Set(
		input.built.conflicts.flatMap((conflict) => conflict.sourceIndexes)
	);
	const classified = input.classification.classified
		.filter((entry) => !conflictSourceIndexes.has(entry.sourceIndex))
		.map((entry) => ({
			legacyKey: entry.displayKey,
			entryFingerprint: entry.entryFingerprint,
			slots: entry.slots,
			destination: entry.destination,
			evidence: entry.evidence
		}));
	const ambiguous: KometaMigrationAmbiguousDisplay[] = [
		...input.classification.ambiguous.map((entry) => ({
			legacyKey: entry.displayKey,
			entryFingerprint: entry.entryFingerprint,
			slots: entry.slots,
			reason: entry.reason
		})),
		...conflictDisplays(input.classification, input.built.conflicts)
	];
	const fileDisplay = (
		file: ReturnType<typeof buildSplitMigrationYaml>['files']['movie'],
		physicalPath: string,
		configReference: string
	) => ({
		filename: file.filename,
		physicalPath,
		configReference,
		sourceFingerprint: file.sourceFingerprint,
		proposedFingerprint: file.proposedFingerprint,
		added: file.added,
		unchanged: file.unchanged,
		changes: file.diff.map((change) => ({
			operation: change.operation,
			path: change.path,
			targetMappingId: change.targetMappingId,
			entryFingerprint: change.entryFingerprint,
			targetFingerprint: change.targetFingerprint
		}))
	});
	return {
		classified,
		ambiguous,
		files: {
			movie: fileDisplay(input.built.files.movie, input.moviePath, input.references.movie),
			show: fileDisplay(input.built.files.show, input.showPath, input.references.show)
		},
		libraries: input.configPlan.changes.map((change) => ({
			library: change.library,
			mediaKind: change.mediaKind,
			before: [...change.before],
			after: change.after
		})),
		diffTruncated: false
	};
}

async function previewInputs(config: AppConfig, binding: KometaServerBinding) {
	const outputDirectory = canonicalConfigPath(kometaOutputDirectory(config));
	const pathBindings = {
		legacy: freezeConfigPath(join(outputDirectory, LEGACY_FILENAME)),
		movie: freezeConfigPath(join(outputDirectory, MOVIE_FILENAME)),
		show: freezeConfigPath(join(outputDirectory, SHOW_FILENAME)),
		config: config.kometaConfigPath ? freezeConfigPath(config.kometaConfigPath) : null
	};
	const legacyPath = pathBindings.legacy.canonicalPath;
	const moviePath = pathBindings.movie.canonicalPath;
	const showPath = pathBindings.show.canonicalPath;
	assertDistinctMigrationPaths([
		legacyPath,
		moviePath,
		showPath,
		...(pathBindings.config ? [pathBindings.config.canonicalPath] : [])
	]);
	const legacyRaw = readConfigAtBinding(pathBindings.legacy);
	const rawConfig = pathBindings.config ? readConfigAtBinding(pathBindings.config) : null;
	const legacyConfig = rawConfig
		? classifyKometaLegacyConfig(rawConfig)
		: { known: !config.kometaConfigPath, references: [] as string[] };
	if (legacyRaw === null && legacyConfig.references.length === 0) {
		throw new KometaMigrationServiceError('kometa_migration_not_required');
	}

	const previousSnapshot = await getKometaLastApplied(snapshotScope(config, binding));
	const previousSnapshotFingerprint = kometaMigrationBaselineFingerprint(previousSnapshot);
	const [cached, managedKeys, evidence] = await Promise.all([
		getCachedLibraries(binding.id),
		getKometaManagedLibraries(),
		loadKometaMigrationEvidence(db, binding.id)
	]);
	const libraries = scopedAuthoritativeLibraries({
		cached,
		managedKeys,
		snapshotLibraries: Object.keys(previousSnapshot?.libraries ?? {}),
		legacyConfigLibraries: legacyConfig.references
	});
	const parsed = parseLegacyMetadata(legacyRaw ?? '');
	const classification = classifyLegacyEntries({ parsed, ...evidence });
	const movieRaw = readConfigAtBinding(pathBindings.movie);
	const showRaw = readConfigAtBinding(pathBindings.show);
	const built = buildSplitMigrationYaml({
		legacyRaw: legacyRaw ?? '',
		movieRaw,
		showRaw,
		classification
	});
	const references = {
		movie: kometaMetadataReference(config.kometaMetadataPathPrefix, MOVIE_FILENAME),
		show: kometaMetadataReference(config.kometaMetadataPathPrefix, SHOW_FILENAME)
	};
	const configPlan = planKometaMigrationConfig({
		rawConfig: rawConfig ?? '',
		mode: config.kometaConfigMode,
		snapshot: previousSnapshot,
		metadataPathPrefix: config.kometaMetadataPathPrefix,
		references,
		libraries
	});
	return {
		outputDirectory,
		legacyPath,
		moviePath,
		showPath,
		pathBindings,
		legacyRaw,
		rawConfig,
		previousSnapshot,
		previousSnapshotFingerprint,
		libraries,
		classification,
		built,
		references,
		configPlan
	};
}

/** Build and persist a read-only, encrypted, exact-content migration preview. */
export async function previewKometaMigration(): Promise<KometaMigrationPreview> {
	const { config, binding } = await resolveBoundScope();
	const existing = await loadKometaMigrationJournalForGuard(binding.id);
	assertExistingMigrationCanStartFreshPreview(existing, config, binding);
	const input = await previewInputs(config, binding);
	assertMigrationConfigActionable(input.configPlan);
	const target = configTarget(
		config,
		input.pathBindings.config?.canonicalPath ?? null,
		input.rawConfig,
		input.configPlan
	);
	const manualSnippet = target.activation === 'manual' ? input.configPlan.manualSnippet : null;
	if (target.activation === 'manual' && manualSnippet === null) {
		throw new KometaMigrationServiceError('kometa_migration_scope_changed');
	}
	const display = migrationDisplay(input);
	const payload = jsonSafe<KometaMigrationPlanPayload>({
		type: KOMETA_MIGRATION_PLAN_KIND,
		version: 1,
		migrationId: randomUUID(),
		serverInstanceId: binding.id,
		serverName: binding.name,
		outputDirectory: input.outputDirectory,
		metadataPathPrefix: config.kometaMetadataPathPrefix,
		references: input.references,
		pathBindings: input.pathBindings,
		legacy: {
			path: input.legacyPath,
			sourceFingerprint: kometaFileFingerprint(input.legacyRaw)
		},
		files: {
			movie: {
				path: input.moviePath,
				sourceFingerprint: input.built.files.movie.sourceFingerprint,
				proposedFingerprint: input.built.files.movie.proposedFingerprint,
				proposedContent: input.built.files.movie.proposedContent
			},
			show: {
				path: input.showPath,
				sourceFingerprint: input.built.files.show.sourceFingerprint,
				proposedFingerprint: input.built.files.show.proposedFingerprint,
				proposedContent: input.built.files.show.proposedContent
			}
		},
		config: target,
		evidenceFingerprint: combinedEvidenceFingerprint(
			input.classification,
			input.libraries,
			input.previousSnapshotFingerprint
		),
		previousSnapshot: input.previousSnapshot,
		previousSnapshotFingerprint: input.previousSnapshotFingerprint,
		nextSnapshot: input.configPlan.nextSnapshot,
		manualSnippet,
		manualSnippetFingerprint:
			manualSnippet === null ? null : kometaManualSnippetFingerprint(manualSnippet),
		display
	});
	assertKometaMigrationPlanPayload(payload);
	const frozen = await operationPlanStore.create({
		kind: KOMETA_MIGRATION_PLAN_KIND,
		serverInstanceId: binding.id,
		payload
	});
	return {
		required: true,
		planId: frozen.id,
		digest: frozen.digest,
		expiresAt: frozen.expiresAt.toISOString(),
		migrationId: payload.migrationId,
		activation: target.activation,
		display,
		manualSnippet: payload.manualSnippet,
		manualSnippetFingerprint: payload.manualSnippetFingerprint,
		fingerprints: {
			legacy: payload.legacy.sourceFingerprint,
			evidence: payload.evidenceFingerprint,
			movieSource: payload.files.movie.sourceFingerprint,
			movieProposed: payload.files.movie.proposedFingerprint,
			showSource: payload.files.show.sourceFingerprint,
			showProposed: payload.files.show.proposedFingerprint,
			configSource: payload.config.sourceFingerprint,
			configProposed: payload.config.proposedFingerprint
		}
	};
}

/** Invalidate a frozen migration preview; replay can no longer confirm it. */
export async function cancelKometaMigrationPreview(
	request: CancelKometaMigrationPreviewRequest
): Promise<{ cancelled: true }> {
	const initial = await loadMigrationPlanForCancellation(request);
	return withConfigLocks(migrationPaths(initial.payload), async () => {
		const pending = await loadMigrationPlanForCancellation(request);
		const { config, binding } = await resolveBoundScope();
		assertCancelledPlanIdentity(pending, KOMETA_MIGRATION_PLAN_KIND, request, binding.id);
		assertFrozenScope(config, binding, pending.payload);
		assertFrozenMigrationBindings(pending.payload);
		return cancelKometaOperationPreview(KOMETA_MIGRATION_PLAN_KIND, request, binding.id);
	});
}

async function assertEvidenceStillCurrent(
	payload: KometaMigrationPlanPayload,
	config: AppConfig,
	options: {
		propagateReadFailure?: boolean;
		database?: KometaMigrationEvidenceDatabase;
	} = {}
): Promise<void> {
	const verify = async (database: KometaMigrationEvidenceDatabase): Promise<void> => {
		let rawConfig: string | null;
		let legacyRaw: string | null;
		try {
			rawConfig = payload.pathBindings.config
				? readConfigAtBinding(payload.pathBindings.config)
				: null;
			legacyRaw = readConfigAtBinding(payload.pathBindings.legacy);
		} catch (error) {
			if (options.propagateReadFailure) throw error;
			throw new OperationPlanError('plan_stale', 'kometa-migration');
		}
		const legacyConfig = rawConfig
			? classifyKometaLegacyConfig(rawConfig)
			: { references: [] as string[] };
		const [currentSnapshot, cached, managedKeys, evidence] = await Promise.all([
			getKometaLastApplied(frozenSnapshotScope(payload), database),
			getCachedLibraries(payload.serverInstanceId, database),
			getKometaManagedLibraries(database),
			loadKometaMigrationEvidence(database, payload.serverInstanceId)
		]);
		const currentSnapshotFingerprint = kometaMigrationBaselineFingerprint(currentSnapshot);
		if (currentSnapshotFingerprint !== payload.previousSnapshotFingerprint) {
			throw new OperationPlanError('plan_stale', 'kometa-migration');
		}
		const libraries = scopedAuthoritativeLibraries({
			cached,
			managedKeys,
			// Manual wiring legitimately removes the last active legacy reference before
			// acknowledgment. Keep the exact resolved library scope frozen in the proposed
			// baseline so that successful wiring does not erase its own evidence context.
			snapshotLibraries: [
				...new Set([
					...Object.keys(payload.previousSnapshot?.libraries ?? {}),
					...Object.keys(payload.nextSnapshot.libraries)
				])
			],
			legacyConfigLibraries: legacyConfig.references
		});
		const parsed = parseLegacyMetadata(legacyRaw ?? '');
		const classification = classifyLegacyEntries({ parsed, ...evidence });
		const configPlan = planKometaMigrationConfig({
			rawConfig: rawConfig ?? '',
			mode: config.kometaConfigMode,
			snapshot: payload.previousSnapshot,
			metadataPathPrefix: payload.metadataPathPrefix,
			references: payload.references,
			libraries
		});
		assertMigrationConfigActionable(configPlan);
		if (
			combinedEvidenceFingerprint(classification, libraries, currentSnapshotFingerprint) !==
				payload.evidenceFingerprint ||
			config.kometaMetadataPathPrefix !== payload.metadataPathPrefix
		) {
			throw new OperationPlanError('plan_stale', 'kometa-migration');
		}
	};

	if (options.database) {
		await verify(options.database);
		return;
	}
	// libSQL starts a write transaction here. Every evidence source is therefore
	// read from one coherent snapshot and no evidence writer can commit mid-check.
	await db.transaction(verify);
}

async function currentMigrationEvidenceState(
	payload: KometaMigrationPlanPayload,
	database?: KometaMigrationEvidenceDatabase
): Promise<'current' | 'changed' | 'unavailable'> {
	try {
		const { config, binding } = await resolveBoundScope();
		assertFrozenScope(config, binding, payload);
		await assertEvidenceStillCurrent(payload, config, {
			propagateReadFailure: true,
			database
		});
		return 'current';
	} catch (error) {
		if (
			(error instanceof OperationPlanError && error.code === 'plan_stale') ||
			(error instanceof KometaMigrationServiceError &&
				(error.code === 'kometa_migration_scope_changed' ||
					error.code === 'kometa_migration_config_incompatible'))
		) {
			return 'changed';
		}
		return 'unavailable';
	}
}

/** Consume a fresh preview, persist the journal, then execute config-last writes. */
export async function confirmKometaMigration(
	request: ConfirmKometaMigrationRequest
): Promise<PublicKometaMigrationState> {
	const initial = await validateMigrationPlan(request);
	return withConfigLocks(migrationPaths(initial.payload), async () => {
		const completed = await withKometaMigrationControlLock(async (assertControlLockOwned) => {
			await assertConfigCommitRecoveryIdle(assertControlLockOwned);
			const pending = await validateMigrationPlan(request);
			const { config, binding } = await resolveBoundScope();
			assertFrozenScope(config, binding, pending.payload);
			assertFrozenMigrationBindings(pending.payload);
			const existing = await loadKometaMigrationJournalForGuard(binding.id);
			await assertControlLockOwned();
			assertExistingMigrationCanStartFreshPreview(existing, config, binding);
			if (pending.payload.display.ambiguous.length > 0 && request.acceptAmbiguous !== true) {
				throw new KometaMigrationServiceError('kometa_migration_ambiguous_confirmation_required');
			}
			await recoverMigrationQuarantines(pending.payload, assertControlLockOwned);
			if (!currentFileMatchesSource(pending.payload)) {
				throw new OperationPlanError('plan_stale', request.planId);
			}
			await assertEvidenceStillCurrent(pending.payload, config);
			// The single-use CAS decides confirm-vs-cancel before a durable journal or
			// filesystem effect exists. A crash in the following narrow gap is safe: no
			// target changed and the user must generate a fresh preview.
			await assertControlLockOwned();
			await operationPlanStore.consume<KometaMigrationPlanPayload>(request.planId, {
				kind: KOMETA_MIGRATION_PLAN_KIND,
				digest: request.digest,
				serverInstanceId: pending.payload.serverInstanceId
			});
			const journalLease = await assertControlLockOwned();
			const journal = createKometaMigrationJournal({
				planId: pending.id,
				planDigest: pending.digest,
				payload: pending.payload,
				now: new Date()
			});
			try {
				await prepareKometaMigrationJournal(journal, existing, journalLease);
			} catch (error) {
				if (error instanceof KometaMigrationStoreError && error.code === 'journal_changed') {
					throw new KometaMigrationServiceError('kometa_migration_in_progress');
				}
				throw error;
			}
			return executeKometaMigration(
				executorDependencies(journal.payload, journalLease, assertControlLockOwned),
				journal
			);
		});
		await logEvent('info', 'kometa_migration', 'kometa_migration_confirmed', {
			serverInstanceId: completed.payload.serverInstanceId,
			migrationId: completed.migrationId,
			status: completed.status,
			activation: completed.payload.config.activation,
			classified: completed.payload.display.classified.length,
			ambiguous: completed.payload.display.ambiguous.length
		});
		refreshMigratedKometaCoverage(completed.payload.serverInstanceId);
		return publicKometaMigrationState(completed, { scopeMatches: true })!;
	});
}

/**
 * Rebuild Kometa coverage after the metadata layout itself moved.
 *
 * Migration rewrites which file every title's entry lives in — the shared
 * `posterpilot.yml` becomes typed movie and show files, or a rollback puts it
 * back. Every Kometa coverage row cites a file, so without this pass the
 * projection would keep pointing at a layout that no longer exists while no
 * artwork or YAML value actually changed underneath it.
 *
 * Server coverage is refreshed alongside it only because the refresher rebuilds
 * both destinations for a scope; nothing here reads or writes media-server
 * artwork. A failure never fails the migration: the files are already committed
 * and the journal is already terminal, so a stale cache is the only cost.
 */
function refreshMigratedKometaCoverage(serverInstanceId: string): void {
	// Fire-and-forget on purpose. Every caller sits inside `withConfigLocks`, and
	// a whole-server projection rebuild must not hold filesystem locks or the
	// user's confirm request open — the files are committed and the journal is
	// terminal before this runs. `refreshCoverageAfter` never throws, so nothing
	// is left unhandled.
	void refreshCoverageAfter('kometa_migration', { serverInstanceId });
}

async function loadScopedJournal(migrationId: string) {
	const config = await resolveConfig();
	const configuredBinding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	const journal =
		(await loadActiveKometaMigrationJournal()) ??
		(configuredBinding.binding
			? await loadKometaMigrationJournal(configuredBinding.binding.id)
			: null);
	if (!journal || journal.migrationId !== migrationId) {
		throw new KometaMigrationServiceError('kometa_migration_not_found');
	}
	const resolvedBinding = await resolveKometaServerBinding(journal.payload.serverInstanceId);
	if (!resolvedBinding.binding) {
		throw new KometaMigrationServiceError(
			kometaBindingErrorCode(
				resolvedBinding.status as Exclude<typeof resolvedBinding.status, 'ready'>
			) as KometaMigrationServiceErrorCode
		);
	}
	const binding = resolvedBinding.binding;
	assertFrozenScope(config, binding, journal.payload);
	assertFrozenMigrationBindings(journal.payload);
	return { config, binding, journal };
}

function recoveryStateOptions(
	journal: KometaMigrationJournalV1
): PublicKometaMigrationStateOptions {
	if (journal.status !== 'failed' && journal.status !== 'recovery_required') return {};
	if (journal.payload.config.activation === 'manual') {
		return { canAbandon: true, recoveryGuidance: 'manual_safe_to_abandon' };
	}
	const config = journal.payload.config;
	const configBinding = journal.payload.pathBindings.config;
	if (
		configBinding === null ||
		config.sourceFingerprint === null ||
		config.proposedFingerprint === null
	) {
		return { recoveryGuidance: 'divergent_manual_intervention' };
	}
	let currentFingerprint: string;
	try {
		currentFingerprint = kometaFileFingerprint(readConfigAtBinding(configBinding));
	} catch {
		return { recoveryGuidance: 'divergent_manual_intervention' };
	}
	if (currentFingerprint === config.sourceFingerprint) {
		return { canAbandon: true, recoveryGuidance: 'source_safe_to_abandon' };
	}
	if (currentFingerprint !== config.proposedFingerprint) {
		return { recoveryGuidance: 'divergent_manual_intervention' };
	}
	if (config.sourceFingerprint === MISSING_FILE_FINGERPRINT && journal.backups.config === null) {
		return { canRecoveryRollback: true, recoveryGuidance: 'proposed_safe_to_rollback' };
	}
	if (journal.backups.config === null) {
		return { recoveryGuidance: 'divergent_manual_intervention' };
	}
	try {
		const backup = readBackupAtBinding(configBinding, journal.backups.config.name, {
			expectedChecksum: journal.backups.config.fingerprint
		});
		if (kometaFileFingerprint(backup) !== config.sourceFingerprint) {
			return { recoveryGuidance: 'divergent_manual_intervention' };
		}
	} catch {
		return { recoveryGuidance: 'divergent_manual_intervention' };
	}
	return { canRecoveryRollback: true, recoveryGuidance: 'proposed_safe_to_rollback' };
}

async function recoverMigrationQuarantines(
	payload: KometaMigrationPlanPayload,
	assertControlLockOwned: () => Promise<KometaMigrationControlLease>
): Promise<void> {
	for (const binding of [
		payload.pathBindings.movie,
		payload.pathBindings.show,
		payload.pathBindings.config
	]) {
		if (binding === null) continue;
		await assertControlLockOwned();
		recoverConfigQuarantineAtBinding(binding);
	}
}

/** Retry only exact source/proposed states from the durable journal; never reclassify. */
export async function resumeKometaMigration(
	request: ResumeKometaMigrationRequest
): Promise<PublicKometaMigrationState> {
	const initial = await loadScopedJournal(request.migrationId);
	return withConfigLocks(migrationPaths(initial.journal.payload), async () => {
		const resumed = await withKometaMigrationControlLock(async (assertControlLockOwned) => {
			await assertConfigCommitRecoveryIdle(assertControlLockOwned);
			const current = await loadScopedJournal(request.migrationId);
			await recoverMigrationQuarantines(current.journal.payload, assertControlLockOwned);
			const lease = await assertControlLockOwned();
			return executeKometaMigration(
				executorDependencies(current.journal.payload, lease, assertControlLockOwned),
				current.journal
			);
		});
		refreshMigratedKometaCoverage(resumed.payload.serverInstanceId);
		return publicKometaMigrationState(resumed, { scopeMatches: true })!;
	});
}

export async function acknowledgeKometaMigration(
	request: AcknowledgeKometaMigrationRequest
): Promise<PublicKometaMigrationState> {
	const initial = await loadScopedJournal(request.migrationId);
	if (initial.journal.payload.manualSnippetFingerprint !== request.manualSnippetFingerprint) {
		throw new KometaMigrationServiceError('kometa_migration_manual_ack_mismatch');
	}
	return withConfigLocks(migrationPaths(initial.journal.payload), async () => {
		const completed = await withKometaMigrationControlLock(async (assertControlLockOwned) => {
			await assertConfigCommitRecoveryIdle(assertControlLockOwned);
			const current = await loadScopedJournal(request.migrationId);
			if (current.journal.payload.manualSnippetFingerprint !== request.manualSnippetFingerprint) {
				throw new KometaMigrationServiceError('kometa_migration_manual_ack_mismatch');
			}
			await recoverMigrationQuarantines(current.journal.payload, assertControlLockOwned);
			const completionLease = await assertControlLockOwned();
			return acknowledgeManualKometaMigration(
				executorDependencies(current.journal.payload, completionLease, assertControlLockOwned),
				current.journal
			);
		});
		await logEvent('info', 'kometa_migration', 'kometa_migration_manual_acknowledged', {
			serverInstanceId: completed.payload.serverInstanceId,
			migrationId: completed.migrationId
		});
		refreshMigratedKometaCoverage(completed.payload.serverInstanceId);
		return publicKometaMigrationState(completed, { scopeMatches: true })!;
	});
}

/** Keep all current files, terminalize only a physically safe failed migration, and unlock replanning. */
export async function abandonKometaMigration(
	request: AbandonKometaMigrationRequest
): Promise<PublicKometaMigrationState> {
	const initial = await loadScopedJournal(request.migrationId);
	return withConfigLocks(migrationPaths(initial.journal.payload), async () => {
		const abandoned = await withKometaMigrationControlLock(async (assertControlLockOwned) => {
			await assertConfigCommitRecoveryIdle(assertControlLockOwned);
			const current = await loadScopedJournal(request.migrationId);
			await recoverMigrationQuarantines(current.journal.payload, assertControlLockOwned);
			if (!recoveryStateOptions(current.journal).canAbandon) {
				throw new KometaMigrationServiceError('kometa_migration_abandon_unavailable');
			}
			const lease = await assertControlLockOwned();
			// Re-read the exact target after the final lease renewal. Collision guards
			// continue checking the frozen source fingerprint after terminalization.
			if (!recoveryStateOptions(current.journal).canAbandon) {
				throw new KometaMigrationServiceError('kometa_migration_abandon_unavailable');
			}
			const next = updateKometaMigrationJournal(
				current.journal,
				{ status: 'abandoned' },
				new Date()
			);
			await saveKometaMigrationJournal(next, current.journal, lease);
			return next;
		});
		await logEvent('warn', 'kometa_migration', 'kometa_migration_abandoned', {
			serverInstanceId: abandoned.payload.serverInstanceId,
			migrationId: abandoned.migrationId,
			failure: abandoned.lastFailure?.code ?? null
		});
		return publicKometaMigrationState(abandoned, { scopeMatches: true })!;
	});
}

function assertRollbackPayload(value: unknown): asserts value is RollbackPlanPayload {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('invalid');
	const payload = value as Record<string, unknown>;
	if (
		payload.type !== ROLLBACK_PLAN_KIND ||
		payload.version !== ROLLBACK_PLAN_VERSION ||
		typeof payload.migrationId !== 'string' ||
		typeof payload.serverInstanceId !== 'string' ||
		typeof payload.configPath !== 'string' ||
		resolve(payload.configPath) !== payload.configPath ||
		!SHA256.test(String(payload.currentFingerprint)) ||
		!(
			(payload.backupName === null && payload.backupChecksum === null) ||
			(typeof payload.backupName === 'string' &&
				!payload.backupName.includes('/') &&
				!payload.backupName.includes('\\') &&
				!payload.backupName.includes('..') &&
				typeof payload.backupChecksum === 'string' &&
				SHA256.test(payload.backupChecksum))
		) ||
		!SHA256.test(String(payload.backupContentFingerprint)) ||
		!SHA256.test(String(payload.baselineFingerprint))
	) {
		throw new TypeError('Invalid Kometa migration rollback plan');
	}
}

async function previewKometaMigrationRollbackLocked(
	migrationId: string
): Promise<KometaMigrationRollbackPreview> {
	const scope = await loadScopedJournal(migrationId);
	const { config: appConfig, binding, journal } = scope;
	const config = journal.payload.config;
	const configBinding = journal.payload.pathBindings.config;
	const backup = journal.backups.config;
	const sourceWasAbsent = config.sourceFingerprint === MISSING_FILE_FINGERPRINT;
	const recovery = recoveryStateOptions(journal);
	const recoveryRollback =
		(journal.status === 'failed' || journal.status === 'recovery_required') &&
		recovery.canRecoveryRollback === true;
	if (
		(journal.status !== 'completed' &&
			journal.status !== 'rollback_prepared' &&
			!recoveryRollback) ||
		config.activation !== 'managed' ||
		config.path === null ||
		configBinding === null ||
		config.proposedFingerprint === null ||
		config.sourceFingerprint === null ||
		(!sourceWasAbsent && backup === null)
	) {
		throw new KometaMigrationServiceError('kometa_migration_rollback_unavailable');
	}
	let current: string | null;
	try {
		current = readConfigAtBinding(configBinding);
	} catch {
		throw new KometaMigrationServiceError('kometa_migration_rollback_unavailable');
	}
	const currentFingerprint = kometaFileFingerprint(current);
	const resumableCurrent =
		journal.status === 'completed'
			? currentFingerprint === config.proposedFingerprint
			: recoveryRollback
				? currentFingerprint === config.proposedFingerprint
				: currentFingerprint === config.proposedFingerprint ||
					currentFingerprint === config.sourceFingerprint;
	if (!resumableCurrent) {
		throw new KometaMigrationServiceError('kometa_migration_rollback_unavailable');
	}
	let backupContent: string | null = null;
	if (backup !== null) {
		try {
			backupContent = readBackupAtBinding(configBinding, backup.name, {
				expectedChecksum: backup.fingerprint
			});
		} catch {
			throw new KometaMigrationServiceError('kometa_migration_rollback_unavailable');
		}
	}
	if (kometaFileFingerprint(backupContent) !== config.sourceFingerprint) {
		throw new KometaMigrationServiceError('kometa_migration_rollback_unavailable');
	}
	const expectedBaseline = journal.checkpoints.baselinePersisted
		? journal.payload.nextSnapshot
		: journal.payload.previousSnapshot;
	const currentBaseline = await getKometaLastApplied(snapshotScope(appConfig, binding));
	const baselineFingerprint = kometaMigrationBaselineFingerprint(currentBaseline);
	if (baselineFingerprint !== kometaMigrationBaselineFingerprint(expectedBaseline)) {
		throw new KometaMigrationServiceError('kometa_migration_rollback_unavailable');
	}
	const diff = rawKometaChanges(current, backupContent ?? '');
	const payload: RollbackPlanPayload = {
		type: ROLLBACK_PLAN_KIND,
		version: ROLLBACK_PLAN_VERSION,
		migrationId: journal.migrationId,
		serverInstanceId: binding.id,
		configPath: config.path,
		currentFingerprint,
		backupName: backup?.name ?? null,
		backupChecksum: backup?.fingerprint ?? null,
		backupContentFingerprint: kometaFileFingerprint(backupContent),
		baselineFingerprint,
		display: {
			changes: diff.changes,
			warnings: diff.truncated ? ['diff_truncated'] : []
		}
	};
	assertRollbackPayload(payload);
	const frozen = await operationPlanStore.create({
		kind: ROLLBACK_PLAN_KIND,
		serverInstanceId: binding.id,
		payload
	});
	return {
		planId: frozen.id,
		digest: frozen.digest,
		expiresAt: frozen.expiresAt.toISOString(),
		migrationId: payload.migrationId,
		changes: payload.display.changes,
		warnings: payload.display.warnings
	};
}

export async function previewKometaMigrationRollback(): Promise<KometaMigrationRollbackPreview> {
	const scope = await resolveBoundScope();
	const journal = await loadKometaMigrationJournalForGuard(scope.binding.id);
	if (!journal) throw new KometaMigrationServiceError('kometa_migration_not_found');
	assertFrozenScope(scope.config, scope.binding, journal.payload);
	assertFrozenMigrationBindings(journal.payload);
	return withConfigLocks(migrationPaths(journal.payload), () =>
		withKometaMigrationControlLock(async (assertControlLockOwned) => {
			await assertConfigCommitRecoveryIdle(assertControlLockOwned);
			const current = await loadScopedJournal(journal.migrationId);
			await recoverMigrationQuarantines(current.journal.payload, assertControlLockOwned);
			await assertControlLockOwned();
			const revalidated = await loadScopedJournal(journal.migrationId);
			return previewKometaMigrationRollbackLocked(revalidated.journal.migrationId);
		})
	);
}

/** Invalidate a frozen rollback preview; replay can no longer confirm it. */
export async function cancelKometaMigrationRollbackPreview(
	request: CancelKometaMigrationPreviewRequest
): Promise<{ cancelled: true }> {
	const initial = await loadRollbackPlanForCancellation(request);
	const scope = await loadScopedJournal(initial.payload.migrationId);
	return withConfigLocks(migrationPaths(scope.journal.payload), async () => {
		const pending = await loadRollbackPlanForCancellation(request);
		const current = await loadScopedJournal(pending.payload.migrationId);
		assertCancelledPlanIdentity(pending, ROLLBACK_PLAN_KIND, request, current.binding.id);
		return cancelKometaOperationPreview(ROLLBACK_PLAN_KIND, request, current.binding.id);
	});
}

async function validateRollbackPlan(request: { planId: string; digest: string }) {
	requireDigest(request);
	const plan = await operationPlanStore.validate<RollbackPlanPayload>(request.planId, {
		kind: ROLLBACK_PLAN_KIND,
		digest: request.digest
	});
	try {
		assertRollbackPayload(plan.payload);
	} catch {
		throw new OperationPlanError('plan_corrupt', request.planId);
	}
	return plan;
}

async function loadRollbackPlanForCancellation(
	request: CancelKometaMigrationPreviewRequest
): Promise<OperationPlan<RollbackPlanPayload>> {
	requireDigest(request);
	const plan = await operationPlanStore.load<RollbackPlanPayload>(request.planId);
	if (!plan) throw new OperationPlanError('plan_not_found', request.planId);
	if (plan.kind !== ROLLBACK_PLAN_KIND) {
		throw new OperationPlanError('plan_kind_mismatch', request.planId);
	}
	if (plan.digest !== request.digest) {
		throw new OperationPlanError('plan_digest_mismatch', request.planId);
	}
	if (plan.consumedAt !== null) throw new OperationPlanError('plan_consumed', request.planId);
	try {
		assertRollbackPayload(plan.payload);
	} catch {
		throw new OperationPlanError('plan_corrupt', request.planId);
	}
	return plan;
}

export async function confirmKometaMigrationRollback(request: {
	planId: string;
	digest: string;
}): Promise<PublicKometaMigrationState> {
	const initial = await validateRollbackPlan(request);
	const scope = await loadScopedJournal(initial.payload.migrationId);
	return withConfigLocks(migrationPaths(scope.journal.payload), async () => {
		const rolledBack = await withKometaMigrationControlLock(async (assertControlLockOwned) => {
			await assertConfigCommitRecoveryIdle(assertControlLockOwned);
			const pending = await validateRollbackPlan(request);
			const current = await loadScopedJournal(pending.payload.migrationId);
			const config = current.journal.payload.config;
			const configBinding = current.journal.payload.pathBindings.config;
			if (configBinding === null) throw new OperationPlanError('plan_stale', request.planId);
			await recoverMigrationQuarantines(current.journal.payload, assertControlLockOwned);
			const recovery = recoveryStateOptions(current.journal);
			const recoveryRollback =
				(current.journal.status === 'failed' || current.journal.status === 'recovery_required') &&
				recovery.canRecoveryRollback === true;
			let currentFingerprint: string;
			try {
				currentFingerprint = kometaFileFingerprint(readConfigAtBinding(configBinding));
			} catch {
				throw new OperationPlanError('plan_stale', request.planId);
			}
			const resumableCurrent =
				(current.journal.status === 'completed' &&
					currentFingerprint === config.proposedFingerprint) ||
				(recoveryRollback && currentFingerprint === config.proposedFingerprint) ||
				(current.journal.status === 'rollback_prepared' &&
					(currentFingerprint === config.proposedFingerprint ||
						currentFingerprint === config.sourceFingerprint));
			if (
				!resumableCurrent ||
				current.journal.payload.serverInstanceId !== pending.payload.serverInstanceId ||
				current.journal.payload.config.path !== pending.payload.configPath ||
				currentFingerprint !== pending.payload.currentFingerprint ||
				(current.journal.backups.config?.name ?? null) !== pending.payload.backupName ||
				(current.journal.backups.config?.fingerprint ?? null) !== pending.payload.backupChecksum
			) {
				throw new OperationPlanError('plan_stale', request.planId);
			}
			let backupContent: string | null = null;
			if (pending.payload.backupName !== null && pending.payload.backupChecksum !== null) {
				try {
					backupContent = readBackupAtBinding(configBinding, pending.payload.backupName, {
						expectedChecksum: pending.payload.backupChecksum
					});
				} catch {
					throw new OperationPlanError('plan_stale', request.planId);
				}
			}
			if (kometaFileFingerprint(backupContent) !== pending.payload.backupContentFingerprint) {
				throw new OperationPlanError('plan_stale', request.planId);
			}
			const expectedBaseline = current.journal.checkpoints.baselinePersisted
				? current.journal.payload.nextSnapshot
				: current.journal.payload.previousSnapshot;
			const currentBaseline = await getKometaLastApplied(
				snapshotScope(current.config, current.binding)
			);
			const currentBaselineFingerprint = kometaMigrationBaselineFingerprint(currentBaseline);
			if (
				currentBaselineFingerprint !== pending.payload.baselineFingerprint ||
				currentBaselineFingerprint !== kometaMigrationBaselineFingerprint(expectedBaseline)
			) {
				throw new OperationPlanError('plan_stale', request.planId);
			}
			await assertControlLockOwned();
			await operationPlanStore.consume(request.planId, {
				kind: ROLLBACK_PLAN_KIND,
				digest: request.digest,
				serverInstanceId: pending.payload.serverInstanceId
			});
			const rollbackLease = await assertControlLockOwned();
			let rollbackPrepared = current.journal;
			if (current.journal.status !== 'rollback_prepared') {
				rollbackPrepared = updateKometaMigrationJournal(
					current.journal,
					{ status: 'rollback_prepared', lastFailure: null },
					new Date()
				);
				await saveKometaMigrationJournal(rollbackPrepared, current.journal, rollbackLease);
			}
			return rollbackKometaMigration(
				executorDependencies(rollbackPrepared.payload, rollbackLease, assertControlLockOwned),
				rollbackPrepared
			);
		});
		await logEvent('info', 'kometa_migration', 'kometa_migration_rolled_back', {
			serverInstanceId: rolledBack.payload.serverInstanceId,
			migrationId: rolledBack.migrationId
		});
		refreshMigratedKometaCoverage(rolledBack.payload.serverInstanceId);
		return publicKometaMigrationState(rolledBack, { scopeMatches: true })!;
	});
}

/** Durable manager projection for SSR/API state. */
export async function loadCurrentKometaMigrationState(): Promise<PublicKometaMigrationState | null> {
	const config = await resolveConfig();
	const binding = await resolveKometaServerBinding(config.kometaServerInstanceId);
	const active = await loadActiveKometaMigrationJournal();
	const journal =
		active ?? (binding.binding ? await loadKometaMigrationJournal(binding.binding.id) : null);
	if (!journal) return null;
	const scopeMatches = Boolean(
		binding.binding && frozenScopeMatches(config, binding.binding, journal.payload)
	);
	if (!scopeMatches) return publicKometaMigrationState(journal, { scopeMatches: false });
	return withConfigLocks(migrationPaths(journal.payload), async () => {
		const current = await loadScopedJournal(journal.migrationId);
		return publicKometaMigrationState(current.journal, {
			scopeMatches: true,
			...recoveryStateOptions(current.journal)
		});
	});
}
