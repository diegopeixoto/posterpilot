import { sql } from 'drizzle-orm';
import { db } from './db';
import { serializeWrite } from './db/write-queue';
import { events } from './db/schema';
import { resolveConfig } from './config';
import { formatEventLine, type EventLevel } from './events-format';
import { appendLogLine } from './log-file';
import { sanitizeSupportEntry } from './support-bundle/sanitize';

export { type EventLevel } from './events-format';

/** Fallback row cap used when the configured `eventRetention` is unavailable. */
const EVENT_RETENTION = 2000;

/** Prune roughly every this-many inserts, to keep the table bounded cheaply. */
const PRUNE_EVERY = 50;

let sinceLastPrune = 0;

/**
 * Record an operational event: insert a row and mirror it to the console. Best
 * effort — a logging failure must never break the work that triggered it.
 */
export async function logEvent(
	level: EventLevel,
	type: string,
	message: string,
	context?: unknown
): Promise<void> {
	const sanitizedContext = safeEventContext(context);
	const line = formatEventLine(level, type, message, sanitizedContext);
	if (level === 'error') console.error(line);
	else if (level === 'warn') console.warn(line);
	else console.log(line);
	// Mirror to the rotating log file (best-effort; never throws).
	appendLogLine(line);

	try {
		const scope = eventScope(context);
		await serializeWrite(() =>
			db.insert(events).values({
				...scope,
				level,
				type,
				message,
				context: sanitizedContext === undefined ? null : safeJson(sanitizedContext)
			})
		);
		if (++sinceLastPrune >= PRUNE_EVERY) {
			sinceLastPrune = 0;
			await pruneEvents();
		}
	} catch (e) {
		// Never let logging failures propagate into the caller.
		console.error(`[error] system: failed to persist event`, e);
	}
}

/** Redact before console, rotating-file, or database serialization; fail closed. */
function safeEventContext(context: unknown): unknown | undefined {
	if (context === undefined || context === null) return undefined;
	try {
		return sanitizeSupportEntry(context);
	} catch {
		return { omitted: 'sanitization_failed' };
	}
}

function eventScope(context: unknown): {
	serverInstanceId?: string;
	jobId?: number;
	mediaItemId?: number;
} {
	if (!context || typeof context !== 'object' || Array.isArray(context)) return {};
	const value = context as Record<string, unknown>;
	return {
		...(typeof value.serverInstanceId === 'string' && value.serverInstanceId
			? { serverInstanceId: value.serverInstanceId }
			: {}),
		...(Number.isSafeInteger(value.jobId) && Number(value.jobId) > 0
			? { jobId: Number(value.jobId) }
			: {}),
		...(Number.isSafeInteger(value.mediaItemId) && Number(value.mediaItemId) > 0
			? { mediaItemId: Number(value.mediaItemId) }
			: {})
	};
}

/**
 * Delete all but the most recent `keep` events. When `keep` is omitted, the
 * configured `eventRetention` (env `EVENT_RETENTION`) is used.
 */
export async function pruneEvents(keep?: number): Promise<void> {
	try {
		const cap = keep ?? (await resolveConfig()).eventRetention ?? EVENT_RETENTION;
		await serializeWrite(() =>
			db.run(
				sql`delete from events where id not in (select id from events order by id desc limit ${cap})`
			)
		);
	} catch (e) {
		console.error(`[error] system: failed to prune events`, e);
	}
}

function safeJson(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return JSON.stringify({ value: String(value) });
	}
}
