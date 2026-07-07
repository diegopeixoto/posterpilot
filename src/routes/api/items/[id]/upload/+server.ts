import { error, json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { resolveConfig } from '$lib/server/config';
import { applyCustomUpload } from '$lib/server/posters/service';
import { getMediaItem } from '$lib/server/queries';
import { sniffImageType } from '$lib/server/posters/image-type';

/** Max upload size, default 15 MB, overridable via `MAX_UPLOAD_MB`. */
const MAX_UPLOAD_BYTES = (Number(env.MAX_UPLOAD_MB) || 15) * 1024 * 1024;

/** Apply a user-uploaded image file as the item's poster (Plex only). */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isFinite(id)) throw error(400, 'invalid id');
	const item = await getMediaItem(id);
	if (!item) throw error(404, 'item not found');

	const form = await request.formData();
	const file = form.get('file');
	if (!(file instanceof File) || file.size === 0) throw error(400, 'no image file provided');

	// Enforce the size cap before reading the bytes into memory.
	if (file.size > MAX_UPLOAD_BYTES) {
		throw error(413, `image exceeds the ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB limit`);
	}

	const bytes = await file.arrayBuffer();
	// Validate by content, not the client-declared type: a spoofed extension is rejected.
	const detected = sniffImageType(bytes);
	if (!detected) throw error(415, 'unsupported image type (only JPEG, PNG, or WebP)');

	const config = await resolveConfig();
	try {
		await applyCustomUpload(item, bytes, detected, config);
		return json({ ok: true });
	} catch (e) {
		return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
	}
};
