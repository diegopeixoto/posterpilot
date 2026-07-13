import { maintenanceMode } from '$lib/server/maintenance';
import { automationStore } from './runtime';
import { createAutomationScheduler, type AutomationSchedulerDependencies } from './scheduler';

let enqueueImplementation: AutomationSchedulerDependencies['enqueue'] | null = null;

const scheduler = createAutomationScheduler({
	store: automationStore,
	enqueue: (payload, options) => {
		if (!enqueueImplementation) throw new Error('automation_scheduler_not_configured');
		return enqueueImplementation(payload, options);
	},
	mutationsAllowed: () => maintenanceMode() === null
});

let timer: ReturnType<typeof setInterval> | null = null;
const DEFAULT_POLL_INTERVAL_MS = 30_000;

export function pollAutomationScheduler(): Promise<void> {
	return scheduler.poll();
}

export function configureAutomationScheduler(
	enqueue: AutomationSchedulerDependencies['enqueue']
): void {
	enqueueImplementation = enqueue;
}

export function notifyAutomationEvent(input: {
	serverInstanceId: string;
	eventType: 'sync_completed' | 'new_items';
	eventIdentity: string;
	items?: Array<{ id: number; librarySectionKey: string }>;
	librarySectionKeys?: string[];
	occurredAt?: Date;
}): Promise<string[]> {
	return scheduler.notifyEvent(input);
}

export function startAutomationScheduler(intervalMs = DEFAULT_POLL_INTERVAL_MS): void {
	if (timer) return;
	if (!Number.isSafeInteger(intervalMs) || intervalMs < 1_000 || intervalMs > 3_600_000) {
		throw new RangeError('automation_poll_interval_invalid');
	}
	void pollAutomationScheduler().catch(() => undefined);
	timer = setInterval(() => {
		void pollAutomationScheduler().catch(() => undefined);
	}, intervalMs);
	(timer as unknown as { unref?: () => void }).unref?.();
}
