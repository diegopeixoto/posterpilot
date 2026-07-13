import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupportBundle, parseSupportBundleRequest } from '$lib/server/support-bundle';

export const POST: RequestHandler = async ({ request }) => {
	const parsed = parseSupportBundleRequest(await request.json().catch(() => null));
	if (!parsed.ok) return json({ error: { code: parsed.code } }, { status: parsed.status });
	try {
		const bundle = await createSupportBundle(parsed.includeTitles);
		return new Response(Uint8Array.from(bundle.bytes), {
			headers: {
				'content-type': 'application/x-tar',
				'content-length': String(bundle.bytes.byteLength),
				'content-disposition': `attachment; filename="${bundle.filename}"`,
				'cache-control': 'no-store'
			}
		});
	} catch {
		return json({ error: { code: 'support_bundle_failed' } }, { status: 500 });
	}
};
