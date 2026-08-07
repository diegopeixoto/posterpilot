import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	KometaConfigMutationRecoveryError,
	recoverPendingKometaConfigMutation
} from '$lib/server/kometa/config-mutation-recovery';
import { PRIVATE_NO_STORE_HEADERS } from '$lib/server/kometa/http-cache';

/** Resume an already-confirmed config save from its authenticated durable checkpoint. */
export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	if (raw.trim() !== '' && raw.trim() !== '{}') {
		return json(
			{ error: { code: 'invalid_request' } },
			{ status: 400, headers: PRIVATE_NO_STORE_HEADERS }
		);
	}
	try {
		return json(await recoverPendingKometaConfigMutation(), {
			headers: PRIVATE_NO_STORE_HEADERS
		});
	} catch (error) {
		if (error instanceof KometaConfigMutationRecoveryError) {
			return json(
				{ error: { code: error.code } },
				{ status: 409, headers: PRIVATE_NO_STORE_HEADERS }
			);
		}
		return json(
			{ error: { code: 'kometa_config_recovery_failed' } },
			{ status: 500, headers: PRIVATE_NO_STORE_HEADERS }
		);
	}
};
