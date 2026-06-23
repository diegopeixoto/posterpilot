import { sql } from 'drizzle-orm';
import { db } from './db';
import { events } from './db/schema';
import { formatEventLine, type EventLevel } from './events-format';

export { formatEventLine, type EventLevel } from './events-format';

/** How many of the most recent events to retain when pruning. */
export const EVENT_RETENTION = 2000;

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
	const line = formatEventLine(level, type, message, context);
	if (level === 'error') console.error(line);
	else if (level === 'warn') console.warn(line);
	else console.log(line);

	try {
		await db.insert(events).values({
			level,
			type,
			message,
			context: context === undefined || context === null ? null : safeJson(context)
		});
		if (++sinceLastPrune >= PRUNE_EVERY) {
			sinceLastPrune = 0;
			await pruneEvents();
		}
	} catch (e) {
		// Never let logging failures propagate into the caller.
		console.error(`[error] system: failed to persist event`, e);
	}
}

/** Delete all but the most recent `keep` events. */
export async function pruneEvents(keep = EVENT_RETENTION): Promise<void> {
	try {
		await db.run(
			sql`delete from events where id not in (select id from events order by id desc limit ${keep})`
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
