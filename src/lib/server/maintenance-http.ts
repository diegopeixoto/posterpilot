import { json } from '@sveltejs/kit';
import { MaintenanceModeError, maintenanceMode } from './maintenance';

export function maintenanceResponse(): Response | null {
	return maintenanceMode() ? json({ error: { code: 'maintenance_mode' } }, { status: 503 }) : null;
}

export function maintenanceErrorResponse(error: unknown): Response | null {
	return error instanceof MaintenanceModeError
		? json({ error: { code: error.code } }, { status: 503 })
		: null;
}

// Once a restore is staged, every write would be silently discarded by the
// boot-time database swap, so the request hook rejects API mutations wholesale.
const MAINTENANCE_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
// Logout only touches the session cookie, never the staged database.
const MAINTENANCE_EXEMPT_PATHS = new Set(['/api/auth/logout']);

/** Whether an in-maintenance request must be rejected with `maintenance_mode`. */
export function maintenanceBlocksRequest(pathname: string, method: string): boolean {
	return (
		pathname.startsWith('/api/') &&
		!MAINTENANCE_SAFE_METHODS.has(method.toUpperCase()) &&
		!MAINTENANCE_EXEMPT_PATHS.has(pathname)
	);
}
