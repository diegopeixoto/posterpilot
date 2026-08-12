import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { databaseClient } from '$lib/server/db';
import { checkDatabaseReadiness } from '$lib/server/db/readiness';
import { describeErrorChain } from '$lib/server/db/error-detail';
import { redactSensitiveText } from '$lib/server/sensitive-redaction';
import { version } from '$lib/version';

export const GET: RequestHandler = async () => {
	const readiness = await checkDatabaseReadiness(databaseClient, undefined, (error) => {
		console.error(
			`[error] GET /api/ready — ${redactSensitiveText(describeErrorChain(error), '[redacted]')}`
		);
	});
	return json(
		{ ...readiness, version },
		{
			status: readiness.status === 'ready' ? 200 : 503,
			headers: { 'cache-control': 'no-store' }
		}
	);
};
