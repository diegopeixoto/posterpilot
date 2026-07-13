import { Readable } from 'node:stream';
import type { RequestHandler } from './$types';
import { exportApplicationBackup } from '$lib/server/backups';
import { backupApiError, readBackupJsonObject } from '$lib/server/backups/http';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readBackupJsonObject(request);
		const exported = await exportApplicationBackup(params.id, body.confirmSecretBearing === true);
		return new Response(Readable.toWeb(exported.stream) as ReadableStream, {
			headers: {
				'Cache-Control': 'no-store',
				'Content-Disposition': `attachment; filename="${exported.filename}"`,
				'Content-Length': String(exported.contentLength),
				'Content-Type': 'application/x-tar',
				'X-Content-Type-Options': 'nosniff'
			}
		});
	} catch (error) {
		return backupApiError(error, 'backup_export_failed');
	}
};
