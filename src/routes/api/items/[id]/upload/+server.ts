import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import {
	confirmActiveCustomUpload,
	previewActiveCustomUpload
} from '$lib/server/artwork-revisions/custom-upload-runtime';
import { assertMutationsAllowed } from '$lib/server/maintenance';
import { sniffImageType } from '$lib/server/posters/image-type';

/** Max upload size, default 15 MB, overridable via `MAX_UPLOAD_MB`. */
const configuredMaxMb = Number(env.MAX_UPLOAD_MB);
const MAX_UPLOAD_BYTES = Math.floor(
	(Number.isFinite(configuredMaxMb) && configuredMaxMb > 0 ? configuredMaxMb : 15) * 1024 * 1024
);

function failure(code: string, status: number, field?: string): Response {
	return json({ error: { code, ...(field ? { field } : {}) } }, { status });
}

function statusFor(code: string): number {
	switch (code) {
		case 'maintenance_mode':
		case 'server_unavailable':
		case 'artwork_read_unavailable':
			return 503;
		case 'item_not_found':
		case 'plan_not_found':
			return 404;
		case 'image_too_large':
			return 413;
		case 'unsupported_content_type':
		case 'content_signature_mismatch':
			return 415;
		case 'server_instance_not_found':
		case 'scope_mismatch':
		case 'plan_scope_mismatch':
		case 'plan_stale':
		case 'plan_expired':
		case 'plan_consumed':
		case 'plan_corrupt':
		case 'plan_kind_mismatch':
		case 'plan_digest_mismatch':
		case 'plan_payload_mismatch':
			return 409;
		case 'invalid_request':
		case 'invalid_input':
		case 'image_size_mismatch':
		case 'image_type_mismatch':
		case 'image_digest_mismatch':
		case 'invalid_plan':
			return 400;
		default:
			return 500;
	}
}

function safeError(error: unknown): Response {
	const code =
		typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
			? error.code
			: 'custom_upload_failed';
	return failure(code, statusFor(code));
}

function itemId(raw: string): number | null {
	const id = Number(raw);
	return Number.isInteger(id) && id > 0 ? id : null;
}

async function uploadFile(
	form: FormData
): Promise<
	| { file: File; bytes: ArrayBuffer; contentType: 'image/jpeg' | 'image/png' | 'image/webp' }
	| Response
> {
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) return failure('invalid_image', 400, 'file');
	if (file.size > MAX_UPLOAD_BYTES) return failure('image_too_large', 413, 'file');
	const bytes = await file.arrayBuffer();
	const contentType = sniffImageType(bytes);
	if (!contentType) return failure('unsupported_content_type', 415, 'file');
	return { file, bytes, contentType };
}

/** Preview a custom root-poster upload. No media-server mutation occurs. */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = itemId(params.id);
	if (id === null) return failure('invalid_request', 400, 'id');
	try {
		assertMutationsAllowed();
		const parsed = await uploadFile(await request.formData());
		if (parsed instanceof Response) return parsed;
		const preview = await previewActiveCustomUpload({
			mediaItemId: id,
			bytes: parsed.bytes,
			contentType: parsed.contentType,
			maxSizeBytes: MAX_UPLOAD_BYTES
		});
		return json({ ok: true, preview });
	} catch (caught) {
		return safeError(caught);
	}
};

/** Confirm exactly the matching preview and execute one revisioned server upload. */
export const PUT: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) return failure('invalid_request', 400, 'id');
	try {
		assertMutationsAllowed();
		const form = await request.formData();
		const parsed = await uploadFile(form);
		if (parsed instanceof Response) return parsed;
		const planId = form.get('planId');
		const digest = form.get('digest');
		if (typeof planId !== 'string' || !planId || typeof digest !== 'string' || !digest) {
			return failure('invalid_request', 400);
		}
		const result = await confirmActiveCustomUpload({
			mediaItemId: id,
			planId,
			digest,
			bytes: parsed.bytes,
			contentType: parsed.contentType,
			sizeBytes: parsed.file.size,
			maxSizeBytes: MAX_UPLOAD_BYTES
		});
		return result.ok
			? json({ ok: true, result })
			: json(
					{
						ok: false,
						error: { code: result.errorCode ?? 'artwork_verification_failed' },
						result
					},
					{ status: 409 }
				);
	} catch (caught) {
		return safeError(caught);
	}
};
