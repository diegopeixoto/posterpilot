import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { automationStore } from '$lib/server/automation/runtime';
import { pollAutomationScheduler } from '$lib/server/automation/scheduler-runtime';
import { assertMutationsAllowed } from '$lib/server/maintenance';

const MAX_BODY_BYTES = 64 * 1024;

class WebhookBodyTooLargeError extends Error {}

function failure(code: string, status: number, field?: string): Response {
	return json(
		{ error: { code, ...(field ? { field } : {}) } },
		{ status, headers: { 'Cache-Control': 'no-store' } }
	);
}

function tokenFrom(request: Request): string {
	const direct = request.headers.get('x-posterpilot-webhook-token');
	if (direct) return direct;
	const authorization = request.headers.get('authorization');
	const match = authorization?.match(/^Bearer\s+([^\s]+)$/i);
	return match?.[1] ?? '';
}

async function readBoundedJson(request: Request): Promise<unknown> {
	if (!request.body) throw new TypeError('invalid_body');
	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > MAX_BODY_BYTES) {
				try {
					await reader.cancel();
				} catch {
					// The bounded rejection remains authoritative if the peer closes concurrently.
				}
				throw new WebhookBodyTooLargeError();
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

function responseError(error: unknown): Response {
	const code =
		typeof error === 'object' &&
		error !== null &&
		'code' in error &&
		typeof error.code === 'string' &&
		/^[A-Za-z0-9._:-]{1,96}$/.test(error.code)
			? error.code
			: 'webhook_request_failed';
	const field =
		typeof error === 'object' &&
		error !== null &&
		'field' in error &&
		typeof error.field === 'string'
			? error.field
			: undefined;
	const status =
		code === 'webhook_unauthorized'
			? 401
			: code === 'maintenance_mode'
				? 503
				: code.startsWith('invalid_') || code === 'webhook_item_scope_mismatch'
					? 400
					: 409;
	return failure(code, status, field);
}

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		assertMutationsAllowed();
		if (!params.id) return failure('invalid_request', 400, 'id');
		const token = tokenFrom(request);
		await automationStore.authenticateWebhook({ scheduleId: params.id, token });
		const declaredLength = Number(request.headers.get('content-length') ?? 0);
		if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
			return failure('invalid_request', 413, 'body');
		}
		let input: Record<string, unknown>;
		try {
			const parsed = await readBoundedJson(request);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
			input = parsed as Record<string, unknown>;
		} catch (error) {
			return failure(
				'invalid_request',
				error instanceof WebhookBodyTooLargeError ? 413 : 400,
				'body'
			);
		}
		if (
			(input.eventType !== 'sync_completed' && input.eventType !== 'new_items') ||
			typeof input.eventId !== 'string' ||
			(input.sourceItemIds !== undefined &&
				(!Array.isArray(input.sourceItemIds) ||
					input.sourceItemIds.some((value) => typeof value !== 'string'))) ||
			Object.keys(input).some(
				(key) => !['eventType', 'eventId', 'sourceItemIds', 'occurredAt'].includes(key)
			)
		) {
			return failure('invalid_request', 400, 'body');
		}
		const occurredAt =
			input.occurredAt === undefined ? new Date() : new Date(String(input.occurredAt));
		if (!Number.isFinite(occurredAt.getTime())) {
			return failure('invalid_request', 400, 'occurredAt');
		}
		const occurrence = await automationStore.deliverWebhook({
			scheduleId: params.id,
			token,
			eventType: input.eventType,
			eventIdentity: input.eventId,
			sourceItemIds: input.sourceItemIds as string[] | undefined,
			occurredAt
		});
		await pollAutomationScheduler();
		return json(
			{ ok: true, occurrenceId: occurrence.id },
			{ status: 202, headers: { 'Cache-Control': 'no-store' } }
		);
	} catch (error) {
		return responseError(error);
	}
};
