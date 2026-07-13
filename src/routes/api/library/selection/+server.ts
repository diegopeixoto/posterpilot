import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { LibrarySelectionError, materializeLibrarySelection } from '$lib/server/library-selection';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const selection = await materializeLibrarySelection(url.search);
		return json({ count: selection.count, fingerprint: selection.fingerprint });
	} catch (error) {
		if (error instanceof LibrarySelectionError) {
			return json(
				{ error: { code: error.code } },
				{ status: error.code === 'no_active_server' ? 409 : 400 }
			);
		}
		return json({ error: { code: 'internal_error' } }, { status: 500 });
	}
};
