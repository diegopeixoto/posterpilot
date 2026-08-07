import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
	preview: vi.fn(),
	confirm: vi.fn(),
	cancel: vi.fn(),
	resume: vi.fn(),
	abandon: vi.fn(),
	acknowledge: vi.fn(),
	previewRollback: vi.fn(),
	confirmRollback: vi.fn(),
	cancelRollback: vi.fn()
}));

vi.mock('$lib/server/kometa/migration', () => {
	class KometaMigrationServiceError extends Error {
		constructor(readonly code: string) {
			super(code);
			this.name = 'KometaMigrationServiceError';
		}
	}
	return {
		KometaMigrationServiceError,
		previewKometaMigration: h.preview,
		confirmKometaMigration: h.confirm,
		cancelKometaMigrationPreview: h.cancel,
		resumeKometaMigration: h.resume,
		abandonKometaMigration: h.abandon,
		acknowledgeKometaMigration: h.acknowledge,
		previewKometaMigrationRollback: h.previewRollback,
		confirmKometaMigrationRollback: h.confirmRollback,
		cancelKometaMigrationRollbackPreview: h.cancelRollback
	};
});

vi.mock('$lib/server/kometa/migration-executor', () => {
	class KometaMigrationExecutionError extends Error {
		constructor(
			readonly code: string,
			readonly phase: string,
			readonly recoveryRequired = false
		) {
			super(code);
			this.name = 'KometaMigrationExecutionError';
		}
	}
	return { KometaMigrationExecutionError };
});

vi.mock('$lib/server/plans/operation-plan-store', () => {
	class OperationPlanError extends Error {
		constructor(
			readonly code: string,
			readonly planId: string
		) {
			super(code);
			this.name = 'OperationPlanError';
		}
	}
	return { OperationPlanError };
});

import { OperationPlanError } from '$lib/server/plans/operation-plan-store';
import { KometaMigrationServiceError } from '$lib/server/kometa/migration';
import { KometaMigrationExecutionError } from '$lib/server/kometa/migration-executor';
import { LegacyMetadataParseError } from '$lib/server/kometa/migration-classifier';
import { POST as preview } from './preview/+server';
import { POST as confirm } from './confirm/+server';
import { POST as cancel } from './cancel/+server';
import { POST as resume } from './resume/+server';
import { POST as abandon } from './abandon/+server';
import { POST as acknowledge } from './acknowledge/+server';
import { POST as previewRollback } from './rollback/preview/+server';
import { POST as confirmRollback } from './rollback/confirm/+server';
import { POST as cancelRollback } from './rollback/cancel/+server';

type PostHandler = (event: { request: Request }) => Promise<Response>;

const digest = 'a'.repeat(64);
const fingerprint = 'b'.repeat(64);

function event(body?: unknown): { request: Request } {
	return {
		request: new Request('http://localhost/api/kometa/migration', {
			method: 'POST',
			...(body === undefined
				? {}
				: {
						body: JSON.stringify(body),
						headers: { 'content-type': 'application/json' }
					})
		})
	};
}

function malformedEvent(): { request: Request } {
	return {
		request: new Request('http://localhost/api/kometa/migration', {
			method: 'POST',
			body: '{',
			headers: { 'content-type': 'application/json' }
		})
	};
}

async function call(handler: unknown, body?: unknown): Promise<Response> {
	return (handler as PostHandler)(event(body));
}

async function expectError(response: Response, status: number, code: string): Promise<void> {
	expect(response.status).toBe(status);
	expect(response.headers.get('cache-control')).toBe('private, no-store');
	expect(await response.json()).toEqual({ error: { code } });
}

describe('Kometa migration HTTP adapters', () => {
	beforeEach(() => vi.clearAllMocks());

	it('previews a migration and marks the sensitive response private/no-store', async () => {
		const result = { required: true, planId: 'plan-1', digest };
		h.preview.mockResolvedValue(result);

		const response = await call(preview);

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual(result);
		expect(h.preview).toHaveBeenCalledOnce();
	});

	it('confirms only an exact preview request and preserves an explicit ambiguous acceptance', async () => {
		const result = { version: 1, status: 'completed' };
		h.confirm.mockResolvedValue(result);

		const response = await call(confirm, {
			planId: 'plan-1',
			digest,
			acceptAmbiguous: false
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual(result);
		expect(h.confirm).toHaveBeenCalledWith({
			planId: 'plan-1',
			digest,
			acceptAmbiguous: false
		});
	});

	it('requires a preview instead of accepting a direct migration payload', async () => {
		const response = await call(confirm, { legacyContent: 'private legacy YAML' });

		await expectError(response, 409, 'preview_required');
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('cancels only the exact migration preview identity', async () => {
		h.cancel.mockResolvedValue({ cancelled: true });

		const response = await call(cancel, { planId: 'plan-1', digest });

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual({ cancelled: true });
		expect(h.cancel).toHaveBeenCalledWith({ planId: 'plan-1', digest });
	});

	it('rejects extra fields when canceling a migration preview', async () => {
		const response = await call(cancel, { planId: 'plan-1', digest, force: true });

		await expectError(response, 400, 'invalid_request');
		expect(h.cancel).not.toHaveBeenCalled();
	});

	it.each([
		['non-object JSON', []],
		['an uppercase digest', { planId: 'plan-1', digest: 'A'.repeat(64) }],
		['a non-boolean ambiguity flag', { planId: 'plan-1', digest, acceptAmbiguous: 'yes' }],
		['an extra field', { planId: 'plan-1', digest, config: 'private' }]
	])('rejects %s as an invalid confirmation body', async (_label, body) => {
		const response = await call(confirm, body);

		await expectError(response, 400, 'invalid_request');
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('rejects malformed JSON without invoking confirmation', async () => {
		const response = await (confirm as PostHandler)(malformedEvent());

		await expectError(response, 400, 'invalid_request');
		expect(h.confirm).not.toHaveBeenCalled();
	});

	it('resumes only the exact migration id', async () => {
		h.resume.mockResolvedValue({ version: 1, status: 'splits_verified' });

		const response = await call(resume, { migrationId: 'migration-1' });

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.resume).toHaveBeenCalledWith({ migrationId: 'migration-1' });
	});

	it.each([{}, { migrationId: '' }, { migrationId: 'migration-1', retry: true }])(
		'rejects an invalid resume body %#',
		async (body) => {
			const response = await call(resume, body);

			await expectError(response, 400, 'invalid_request');
			expect(h.resume).not.toHaveBeenCalled();
		}
	);

	it('abandons only the exact migration id', async () => {
		h.abandon.mockResolvedValue({ version: 1, status: 'abandoned' });

		const response = await call(abandon, { migrationId: 'migration-1' });

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.abandon).toHaveBeenCalledWith({ migrationId: 'migration-1' });
	});

	it.each([{}, { migrationId: '' }, { migrationId: 'migration-1', force: true }])(
		'rejects an invalid abandon body %#',
		async (body) => {
			const response = await call(abandon, body);

			await expectError(response, 400, 'invalid_request');
			expect(h.abandon).not.toHaveBeenCalled();
		}
	);

	it('acknowledges manual wiring only with the frozen SHA-256 fingerprint', async () => {
		h.acknowledge.mockResolvedValue({ version: 1, status: 'completed' });

		const response = await call(acknowledge, {
			migrationId: 'migration-1',
			manualSnippetFingerprint: fingerprint
		});

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.acknowledge).toHaveBeenCalledWith({
			migrationId: 'migration-1',
			manualSnippetFingerprint: fingerprint
		});
	});

	it.each([
		{ migrationId: 'migration-1', manualSnippetFingerprint: 'short' },
		{ migrationId: 'migration-1', manualSnippetFingerprint: fingerprint, acknowledged: true }
	])('rejects an invalid acknowledgement body %#', async (body) => {
		const response = await call(acknowledge, body);

		await expectError(response, 400, 'invalid_request');
		expect(h.acknowledge).not.toHaveBeenCalled();
	});

	it('previews rollback without taking client-supplied state', async () => {
		const result = { planId: 'rollback-1', digest, changes: [], warnings: [] };
		h.previewRollback.mockResolvedValue(result);

		const response = await call(previewRollback);

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual(result);
		expect(h.previewRollback).toHaveBeenCalledOnce();
	});

	it('confirms rollback with only its exact plan identity', async () => {
		h.confirmRollback.mockResolvedValue({ version: 1, status: 'rolled_back' });

		const response = await call(confirmRollback, { planId: 'rollback-1', digest });

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(h.confirmRollback).toHaveBeenCalledWith({ planId: 'rollback-1', digest });
	});

	it('cancels only the exact rollback preview identity', async () => {
		h.cancelRollback.mockResolvedValue({ cancelled: true });

		const response = await call(cancelRollback, { planId: 'rollback-1', digest });

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
		expect(await response.json()).toEqual({ cancelled: true });
		expect(h.cancelRollback).toHaveBeenCalledWith({ planId: 'rollback-1', digest });
	});

	it('requires a rollback preview before confirmation', async () => {
		const response = await call(confirmRollback, {});

		await expectError(response, 409, 'preview_required');
		expect(h.confirmRollback).not.toHaveBeenCalled();
	});

	it('maps ambiguous migration confirmation to a safe conflict code', async () => {
		h.confirm.mockRejectedValue(
			new KometaMigrationServiceError('kometa_migration_ambiguous_confirmation_required')
		);

		const response = await call(confirm, { planId: 'plan-1', digest });

		await expectError(response, 409, 'kometa_migration_ambiguous_confirmation_required');
	});

	it('maps stale plans to conflict without exposing the plan exception message', async () => {
		h.confirmRollback.mockRejectedValue(new OperationPlanError('plan_stale', 'rollback-1'));

		const response = await call(confirmRollback, { planId: 'rollback-1', digest });

		await expectError(response, 409, 'plan_stale');
	});

	it('maps an expired preview to gone so the client rebuilds it', async () => {
		h.confirm.mockRejectedValue(new OperationPlanError('plan_expired', 'plan-1'));

		const response = await call(confirm, { planId: 'plan-1', digest });

		await expectError(response, 410, 'plan_expired');
	});

	it('maps bounded invalid legacy input to an actionable client error', async () => {
		h.preview.mockRejectedValue(new LegacyMetadataParseError('legacy_source_too_large'));

		const response = await call(preview);

		await expectError(response, 422, 'legacy_source_too_large');
	});

	it('marks an unavailable bound server as temporarily unavailable', async () => {
		h.preview.mockRejectedValue(
			new KometaMigrationServiceError('kometa_server_binding_unavailable')
		);

		const response = await call(preview);

		await expectError(response, 503, 'kometa_server_binding_unavailable');
	});

	it('maps a missing migration to not found', async () => {
		h.resume.mockRejectedValue(new KometaMigrationServiceError('kometa_migration_not_found'));

		const response = await call(resume, { migrationId: 'migration-1' });

		await expectError(response, 404, 'kometa_migration_not_found');
	});

	it('maps bounded execution write failures to a safe server error', async () => {
		h.resume.mockRejectedValue(
			new KometaMigrationExecutionError('migration_write_failed', 'movie_write')
		);

		const response = await call(resume, { migrationId: 'migration-1' });

		await expectError(response, 500, 'migration_write_failed');
	});

	it('marks commit-boundary evidence outages as temporarily unavailable', async () => {
		h.resume.mockRejectedValue(
			new KometaMigrationExecutionError('migration_evidence_unavailable', 'source_revalidate')
		);

		const response = await call(resume, { migrationId: 'migration-1' });

		await expectError(response, 503, 'migration_evidence_unavailable');
	});

	it('hides unknown exception details and keeps the error response private/no-store', async () => {
		h.preview.mockRejectedValue(new Error('/private/config.yml: permission denied'));

		const response = await call(preview);

		await expectError(response, 500, 'kometa_migration_failed');
	});
});
