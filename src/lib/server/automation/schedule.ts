export type AutomationTriggerType = 'interval' | 'daily' | 'event';

export interface IntervalSchedule {
	triggerType: 'interval';
	intervalMinutes: number;
	timezone: string;
}

export interface DailySchedule {
	triggerType: 'daily';
	localTime: string;
	timezone: string;
}

export interface EventSchedule {
	triggerType: 'event';
	eventType: string;
	timezone: string;
}

export type AutomationScheduleTiming = IntervalSchedule | DailySchedule | EventSchedule;

export type DueOccurrenceDecision =
	| { state: 'not_due'; lagMs: 0 }
	| { state: 'due'; lagMs: number }
	| { state: 'missed'; lagMs: number };

export class AutomationScheduleValidationError extends TypeError {
	constructor(readonly code: string) {
		super(code);
		this.name = 'AutomationScheduleValidationError';
	}
}

interface ZonedParts {
	year: number;
	month: number;
	day: number;
	hour: number;
	minute: number;
	second: number;
}

interface CalendarDate {
	year: number;
	month: number;
	day: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MIN_INTERVAL_MINUTES = 5;
const MAX_INTERVAL_MINUTES = 366 * 24 * 60;

function validationError(code: string): never {
	throw new AutomationScheduleValidationError(code);
}

function validDate(value: Date, code = 'invalid_date'): Date {
	const copy = new Date(value.getTime());
	if (!Number.isFinite(copy.getTime())) validationError(code);
	return copy;
}

function formatter(timezone: string): Intl.DateTimeFormat {
	let value = formatterCache.get(timezone);
	if (value) return value;
	try {
		value = new Intl.DateTimeFormat('en-CA-u-hc-h23', {
			timeZone: timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			hourCycle: 'h23'
		});
		// Some engines validate lazily.
		value.format(new Date(0));
	} catch {
		validationError('invalid_timezone');
	}
	formatterCache.set(timezone, value);
	return value;
}

function isValidTimeZone(timezone: string): boolean {
	if (!timezone || timezone.trim() !== timezone) return false;
	try {
		formatter(timezone);
		return true;
	} catch {
		return false;
	}
}

export function assertTimeZone(timezone: string): void {
	if (!isValidTimeZone(timezone)) validationError('invalid_timezone');
}

export function parseLocalTime(value: string): { hour: number; minute: number } {
	const match = LOCAL_TIME_PATTERN.exec(value);
	if (!match) validationError('invalid_local_time');
	return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function assertIntervalMinutes(value: number): void {
	if (
		!Number.isSafeInteger(value) ||
		value < MIN_INTERVAL_MINUTES ||
		value > MAX_INTERVAL_MINUTES
	) {
		validationError('invalid_interval');
	}
}

function zonedParts(value: Date, timezone: string): ZonedParts {
	const parts = formatter(timezone).formatToParts(value);
	const map = new Map<string, string>(parts.map((part) => [part.type, part.value]));
	const number = (name: string) => Number(map.get(name));
	const result = {
		year: number('year'),
		month: number('month'),
		day: number('day'),
		hour: number('hour'),
		minute: number('minute'),
		second: number('second')
	};
	if (Object.values(result).some((part) => !Number.isFinite(part))) {
		validationError('invalid_timezone');
	}
	return result;
}

function dateKey(date: CalendarDate): string {
	return `${String(date.year).padStart(4, '0')}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

export function localDateKey(value: Date, timezone: string): string {
	assertTimeZone(timezone);
	const parts = zonedParts(validDate(value), timezone);
	return dateKey(parts);
}

function parseDateKey(value: string): CalendarDate {
	const match = DATE_KEY_PATTERN.exec(value);
	if (!match) validationError('invalid_local_date');
	const date = {
		year: Number(match[1]),
		month: Number(match[2]),
		day: Number(match[3])
	};
	const check = new Date(Date.UTC(date.year, date.month - 1, date.day));
	if (
		check.getUTCFullYear() !== date.year ||
		check.getUTCMonth() + 1 !== date.month ||
		check.getUTCDate() !== date.day
	) {
		validationError('invalid_local_date');
	}
	return date;
}

function addCalendarDays(date: CalendarDate, days: number): CalendarDate {
	const next = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
	return {
		year: next.getUTCFullYear(),
		month: next.getUTCMonth() + 1,
		day: next.getUTCDate()
	};
}

function offsetMilliseconds(value: Date, timezone: string): number {
	const parts = zonedParts(value, timezone);
	const representedAsUtc = Date.UTC(
		parts.year,
		parts.month - 1,
		parts.day,
		parts.hour,
		parts.minute,
		parts.second
	);
	return representedAsUtc - Math.floor(value.getTime() / 1000) * 1000;
}

function exactLocalInstants(
	date: CalendarDate,
	hour: number,
	minute: number,
	timezone: string
): Date[] {
	const localAsUtc = Date.UTC(date.year, date.month - 1, date.day, hour, minute, 0);
	const offsets = new Set<number>();
	for (const sampleHours of [-48, -24, -12, 0, 12, 24, 48]) {
		offsets.add(offsetMilliseconds(new Date(localAsUtc + sampleHours * 3_600_000), timezone));
	}
	const candidates: Date[] = [];
	for (const offset of offsets) {
		const candidate = new Date(localAsUtc - offset);
		const parts = zonedParts(candidate, timezone);
		if (
			parts.year === date.year &&
			parts.month === date.month &&
			parts.day === date.day &&
			parts.hour === hour &&
			parts.minute === minute &&
			parts.second === 0
		) {
			candidates.push(candidate);
		}
	}
	return candidates.sort((left, right) => left.getTime() - right.getTime());
}

/**
 * Resolve a local wall-clock minute. During a spring-forward gap, use the first
 * representable minute later that same local day. During a fall-back overlap,
 * return both instants so callers can deliberately avoid double execution.
 */
export function resolveDailyWallTime(
	localDate: string,
	localTime: string,
	timezone: string
): Date[] {
	assertTimeZone(timezone);
	const date = parseDateKey(localDate);
	const requested = parseLocalTime(localTime);
	const requestedMinute = requested.hour * 60 + requested.minute;
	for (let minuteOfDay = requestedMinute; minuteOfDay < 24 * 60; minuteOfDay += 1) {
		const candidates = exactLocalInstants(
			date,
			Math.floor(minuteOfDay / 60),
			minuteOfDay % 60,
			timezone
		);
		if (candidates.length > 0) return candidates;
	}
	return [];
}

export function nextDailyRun(after: Date, localTime: string, timezone: string): Date {
	const cursor = validDate(after);
	assertTimeZone(timezone);
	parseLocalTime(localTime);
	let localDate = parseDateKey(localDateKey(cursor, timezone));
	for (let dayOffset = 0; dayOffset <= 370; dayOffset += 1) {
		const candidates = resolveDailyWallTime(dateKey(localDate), localTime, timezone);
		const next = candidates.find((candidate) => candidate.getTime() > cursor.getTime());
		if (next) return next;
		localDate = addCalendarDays(localDate, 1);
	}
	validationError('daily_occurrence_unresolvable');
}

/** Advance from a completed logical local day, never scheduling the repeated DST hour twice. */
export function nextDailyRunAfterOccurrence(
	previousScheduledFor: Date,
	localTime: string,
	timezone: string
): Date {
	const previous = validDate(previousScheduledFor);
	assertTimeZone(timezone);
	parseLocalTime(localTime);
	let date = addCalendarDays(parseDateKey(localDateKey(previous, timezone)), 1);
	for (let dayOffset = 0; dayOffset <= 370; dayOffset += 1) {
		const candidates = resolveDailyWallTime(dateKey(date), localTime, timezone);
		if (candidates[0]) return candidates[0];
		date = addCalendarDays(date, 1);
	}
	validationError('daily_occurrence_unresolvable');
}

/** Anchored interval calculation avoids drift when the worker polls late. */
export function nextIntervalRun(after: Date, anchor: Date, intervalMinutes: number): Date {
	const cursor = validDate(after);
	const origin = validDate(anchor, 'invalid_anchor');
	assertIntervalMinutes(intervalMinutes);
	const intervalMs = intervalMinutes * 60_000;
	if (cursor.getTime() < origin.getTime()) return origin;
	const elapsed = cursor.getTime() - origin.getTime();
	const steps = Math.floor(elapsed / intervalMs) + 1;
	return new Date(origin.getTime() + steps * intervalMs);
}

export function dueOccurrenceDecision(
	nextRunAt: Date,
	now: Date,
	catchUpWindowMinutes: number
): DueOccurrenceDecision {
	const due = validDate(nextRunAt);
	const current = validDate(now);
	if (
		!Number.isSafeInteger(catchUpWindowMinutes) ||
		catchUpWindowMinutes < 0 ||
		catchUpWindowMinutes > 10_080
	) {
		validationError('invalid_catch_up_window');
	}
	if (current.getTime() < due.getTime()) return { state: 'not_due', lagMs: 0 };
	const lagMs = current.getTime() - due.getTime();
	return lagMs <= catchUpWindowMinutes * 60_000
		? { state: 'due', lagMs }
		: { state: 'missed', lagMs };
}

export function scheduleLogicalKey(input: {
	scheduleId: string;
	triggerType: AutomationTriggerType;
	scheduledFor: Date;
	timezone: string;
	eventIdentity?: string | null;
}): string {
	if (!input.scheduleId || input.scheduleId.trim() !== input.scheduleId) {
		validationError('invalid_schedule_id');
	}
	const scheduledFor = validDate(input.scheduledFor);
	assertTimeZone(input.timezone);
	if (input.triggerType === 'event') {
		if (!input.eventIdentity || input.eventIdentity.trim() !== input.eventIdentity) {
			validationError('invalid_event_identity');
		}
		return `event:${input.eventIdentity}`;
	}
	if (input.triggerType === 'daily') {
		return `daily:${localDateKey(scheduledFor, input.timezone)}`;
	}
	return `interval:${scheduledFor.toISOString()}`;
}
