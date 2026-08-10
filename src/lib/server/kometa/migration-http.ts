import { json } from '@sveltejs/kit';
import { OperationPlanError } from '$lib/server/plans/operation-plan-store';
import {
	KometaMigrationServiceError,
	type AcknowledgeKometaMigrationRequest,
	type AbandonKometaMigrationRequest,
	type CancelKometaMigrationPreviewRequest,
	type ConfirmKometaMigrationRequest,
	type ResumeKometaMigrationRequest
} from './migration';
import { KometaMigrationExecutionError } from './migration-executor';
import { LegacyMetadataParseError } from './migration-classifier';
import { KometaMigrationEvidenceError } from './migration-evidence';
import { MigrationYamlBuildError } from './migration-yaml';
import { PRIVATE_NO_STORE_HEADERS } from './http-cache';

const SHA256 = /^[0-9a-f]{64}$/;
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

type JsonObject = Record<string, unknown>;
type InvalidRequestCode = 'invalid_request' | 'preview_required';

export type ParsedMigrationRequest<T> =
	| { ok: true; value: T }
	| { ok: false; code: InvalidRequestCode };

function object(value: unknown): JsonObject | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as JsonObject)
		: null;
}

function hasOnlyKeys(body: JsonObject, allowed: readonly string[]): boolean {
	return Object.keys(body).every((key) => allowed.includes(key));
}

function validOpaqueId(value: unknown): value is string {
	return typeof value === 'string' && OPAQUE_ID.test(value);
}

function validSha256(value: unknown): value is string {
	return typeof value === 'string' && SHA256.test(value);
}

export async function readMigrationJson(request: Request): Promise<unknown> {
	return request.json().catch(() => null);
}

export function parseMigrationConfirmation(
	value: unknown,
	options: { allowAmbiguous: boolean }
): ParsedMigrationRequest<ConfirmKometaMigrationRequest> {
	const body = object(value);
	if (!body) return { ok: false, code: 'invalid_request' };
	if (!Object.hasOwn(body, 'planId') || !Object.hasOwn(body, 'digest')) {
		return { ok: false, code: 'preview_required' };
	}
	const allowed = options.allowAmbiguous
		? (['planId', 'digest', 'acceptAmbiguous', 'acceptConfigRemovals'] as const)
		: (['planId', 'digest'] as const);
	if (
		!hasOnlyKeys(body, allowed) ||
		!validOpaqueId(body.planId) ||
		!validSha256(body.digest) ||
		(options.allowAmbiguous &&
			Object.hasOwn(body, 'acceptAmbiguous') &&
			typeof body.acceptAmbiguous !== 'boolean') ||
		(options.allowAmbiguous &&
			Object.hasOwn(body, 'acceptConfigRemovals') &&
			typeof body.acceptConfigRemovals !== 'boolean')
	) {
		return { ok: false, code: 'invalid_request' };
	}
	return {
		ok: true,
		value: {
			planId: body.planId,
			digest: body.digest,
			...(options.allowAmbiguous && Object.hasOwn(body, 'acceptAmbiguous')
				? { acceptAmbiguous: body.acceptAmbiguous as boolean }
				: {}),
			...(options.allowAmbiguous && Object.hasOwn(body, 'acceptConfigRemovals')
				? { acceptConfigRemovals: body.acceptConfigRemovals as boolean }
				: {})
		}
	};
}

export function parseMigrationPlanIdentity(
	value: unknown
): ParsedMigrationRequest<CancelKometaMigrationPreviewRequest> {
	const body = object(value);
	if (!body) return { ok: false, code: 'invalid_request' };
	if (!Object.hasOwn(body, 'planId') || !Object.hasOwn(body, 'digest')) {
		return { ok: false, code: 'preview_required' };
	}
	if (
		!hasOnlyKeys(body, ['planId', 'digest']) ||
		!validOpaqueId(body.planId) ||
		!validSha256(body.digest)
	) {
		return { ok: false, code: 'invalid_request' };
	}
	return { ok: true, value: { planId: body.planId, digest: body.digest } };
}

export function parseMigrationResume(
	value: unknown
): ParsedMigrationRequest<ResumeKometaMigrationRequest> {
	const body = object(value);
	if (!body || !hasOnlyKeys(body, ['migrationId']) || !validOpaqueId(body.migrationId)) {
		return { ok: false, code: 'invalid_request' };
	}
	return { ok: true, value: { migrationId: body.migrationId } };
}

export function parseMigrationAbandon(
	value: unknown
): ParsedMigrationRequest<AbandonKometaMigrationRequest> {
	const body = object(value);
	if (!body || !hasOnlyKeys(body, ['migrationId']) || !validOpaqueId(body.migrationId)) {
		return { ok: false, code: 'invalid_request' };
	}
	return { ok: true, value: { migrationId: body.migrationId } };
}

export function parseMigrationAcknowledgement(
	value: unknown
): ParsedMigrationRequest<AcknowledgeKometaMigrationRequest> {
	const body = object(value);
	if (
		!body ||
		!hasOnlyKeys(body, ['migrationId', 'manualSnippetFingerprint']) ||
		!validOpaqueId(body.migrationId) ||
		!validSha256(body.manualSnippetFingerprint)
	) {
		return { ok: false, code: 'invalid_request' };
	}
	return {
		ok: true,
		value: {
			migrationId: body.migrationId,
			manualSnippetFingerprint: body.manualSnippetFingerprint
		}
	};
}

export function migrationJson(data: unknown, status = 200): Response {
	return json(data, { status, headers: PRIVATE_NO_STORE_HEADERS });
}

export function migrationRequestError(code: InvalidRequestCode): Response {
	return migrationJson({ error: { code } }, code === 'preview_required' ? 409 : 400);
}

/** Map only bounded, locale-neutral codes; exception messages never cross this boundary. */
export function kometaMigrationApiError(error: unknown): Response {
	if (error instanceof OperationPlanError) {
		const status =
			error.code === 'plan_not_found'
				? 404
				: error.code === 'plan_expired'
					? 410
					: error.code === 'plan_corrupt'
						? 500
						: 409;
		return migrationJson({ error: { code: error.code } }, status);
	}
	if (error instanceof KometaMigrationServiceError) {
		const status =
			error.code === 'kometa_migration_not_found'
				? 404
				: error.code === 'kometa_server_binding_unavailable'
					? 503
					: 409;
		return migrationJson(
			{
				error: {
					code: error.code,
					...(error.incompatibilities?.length ? { incompatibilities: error.incompatibilities } : {})
				}
			},
			status
		);
	}
	if (
		error instanceof LegacyMetadataParseError ||
		error instanceof KometaMigrationEvidenceError ||
		error instanceof MigrationYamlBuildError
	) {
		return migrationJson({ error: { code: error.code } }, 422);
	}
	if (error instanceof KometaMigrationExecutionError) {
		const status =
			error.code === 'migration_evidence_unavailable'
				? 503
				: error.code === 'migration_write_failed' || error.code === 'migration_verify_failed'
					? 500
					: 409;
		return migrationJson({ error: { code: error.code } }, status);
	}
	return migrationJson({ error: { code: 'kometa_migration_failed' } }, 500);
}
