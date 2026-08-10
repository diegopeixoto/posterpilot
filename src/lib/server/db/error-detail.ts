/**
 * Flattens an error and everything on its `cause` chain into one loggable line.
 *
 * Drizzle wraps every failed statement in a `DrizzleQueryError` whose message is
 * only `Failed query: <sql>` — the SQLite code that says *why* lives on `cause`,
 * and the default stack print drops it. Issue #91 was reported with exactly that
 * shape: 815 identical failures whose underlying code nobody could recover, which
 * left the difference between lock contention and a connection that could not be
 * opened unresolvable from the logs alone.
 *
 * libsql surfaces its own fields rather than the standard ones, and not always:
 * `code` is `"SQLITE_BUSY"` for contention but an empty string for a failure to
 * open a connection, where the reason is only in the message. Both are recorded.
 */

/** The libsql/SQLite fields worth reading off an error, when present. */
interface DatabaseErrorFields {
	code?: unknown;
	rawCode?: unknown;
	extendedCode?: unknown;
}

const MAX_CAUSE_DEPTH = 5;
const MAX_MESSAGE_LENGTH = 300;

function describe(error: unknown): string {
	if (!(error instanceof Error)) return String(error).slice(0, MAX_MESSAGE_LENGTH);
	const fields = error as unknown as DatabaseErrorFields;
	const parts = [error.name];
	// An empty-string code is meaningful — it is what a failed connection open
	// reports — so include it whenever the property exists at all.
	if (typeof fields.code === 'string') parts.push(`code=${fields.code || '(empty)'}`);
	if (fields.rawCode !== undefined) parts.push(`rawCode=${String(fields.rawCode)}`);
	if (fields.extendedCode !== undefined) parts.push(`extendedCode=${String(fields.extendedCode)}`);
	// Newlines are stripped so one error stays one log line: drizzle's message
	// embeds the full SQL followed by a `params:` line.
	const message = error.message.replace(/\s+/g, ' ').slice(0, MAX_MESSAGE_LENGTH);
	return `${parts.join(' ')}: ${message}`;
}

/**
 * Render `error` and its causes as `outer <- cause <- root`.
 *
 * Bounded in depth so a self-referential chain cannot spin, and by identity so a
 * cause that points back at an ancestor terminates rather than repeating.
 */
export function describeErrorChain(error: unknown): string {
	const seen = new Set<unknown>();
	const parts: string[] = [];
	let current: unknown = error;
	for (
		let depth = 0;
		depth < MAX_CAUSE_DEPTH && current !== undefined && current !== null;
		depth++
	) {
		if (seen.has(current)) break;
		seen.add(current);
		parts.push(describe(current));
		current = current instanceof Error ? current.cause : undefined;
	}
	return parts.join(' <- ');
}
