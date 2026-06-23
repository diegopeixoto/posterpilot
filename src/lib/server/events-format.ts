export type EventLevel = 'info' | 'warn' | 'error';

/**
 * Format an event as a single console line: `[level] type: message {context}`.
 * Pure (no I/O, no DB) so it stays importable from unit tests without pulling in
 * `$env`/`$app`.
 */
export function formatEventLine(
	level: EventLevel,
	type: string,
	message: string,
	context?: unknown
): string {
	const base = `[${level}] ${type}: ${message}`;
	if (context === undefined || context === null) return base;
	let serialized: string;
	try {
		serialized = JSON.stringify(context);
	} catch {
		serialized = String(context);
	}
	return `${base} ${serialized}`;
}
