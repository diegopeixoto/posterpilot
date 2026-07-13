export type MaintenanceReason = 'application_restore';

export class MaintenanceModeError extends Error {
	readonly code = 'maintenance_mode';

	constructor(readonly reason: MaintenanceReason) {
		super('maintenance_mode');
		this.name = 'MaintenanceModeError';
	}
}

interface MaintenanceState {
	reason: MaintenanceReason;
	startedAt: Date;
}

let state: MaintenanceState | null = null;

export function enterMaintenanceMode(
	reason: MaintenanceReason,
	now = new Date()
): MaintenanceState {
	if (state) return state;
	state = { reason, startedAt: new Date(now) };
	return state;
}

export function leaveMaintenanceMode(reason: MaintenanceReason): void {
	if (state?.reason === reason) state = null;
}

export function maintenanceMode(): Readonly<MaintenanceState> | null {
	return state ? { reason: state.reason, startedAt: new Date(state.startedAt) } : null;
}

export function assertMutationsAllowed(): void {
	if (state) throw new MaintenanceModeError(state.reason);
}

/** Test-only reset; production callers leave maintenance only after safe abort. */
export function resetMaintenanceModeForTests(): void {
	state = null;
}
