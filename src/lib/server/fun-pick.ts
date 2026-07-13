/**
 * Pure domain model for FUN experiments. URL parsing, presets, validation and seeded
 * ranking stay framework/DB-free so every FUN route shares the same reproducible rules.
 */

export { funResultId, funSeedHash, rankFunItems } from '$lib/fun-seed';

const FUN_MAX_CHOICES = 3;
export const FUN_MAX_RECENT_EXCLUSIONS = 24;

export type FunPreset = 'movie-night' | 'quick-watch' | 'acclaimed' | 'fresh-unwatched';
export type FunRevealMode = 'standard' | 'blind' | 'capsule';

export interface PickFilter {
	serverInstanceId?: string;
	librarySectionKey?: string;
	type?: 'movie' | 'show';
	genre?: string;
	yearMin?: number;
	yearMax?: number;
	runtimeMin?: number;
	runtimeMax?: number;
	ratingMin?: number;
	/** Only items added to the server in this many days. */
	addedWithinDays?: number;
	excludeWatched: boolean;
	preset?: FunPreset;
	count: 1 | 2 | 3;
	seed?: string;
	excludeItemIds: number[];
	mode: FunRevealMode;
}

export type PickFilterField =
	| 'server'
	| 'library'
	| 'type'
	| 'yearMin'
	| 'yearMax'
	| 'runtimeMin'
	| 'runtimeMax'
	| 'ratingMin'
	| 'addedWithinDays'
	| 'count'
	| 'seed'
	| 'exclude'
	| 'mode';

export type PickFilterErrorCode = 'invalid' | 'out_of_range' | 'min_greater_than_max';

export interface ParsedPickFilter {
	filter: PickFilter;
	errors: Partial<Record<PickFilterField, PickFilterErrorCode>>;
}

/** Parse the exact ordered ids carried by a canonical shared FUN result URL. */
export function parseFunSharedItemIds(raw: string | null): number[] {
	if (!raw) return [];
	const parts = raw.split(',');
	if (parts.length === 0 || parts.length > FUN_MAX_CHOICES) return [];
	const ids: number[] = [];
	for (const part of parts) {
		const id = Number(part);
		if (!Number.isSafeInteger(id) || id <= 0 || ids.includes(id)) return [];
		ids.push(id);
	}
	return ids;
}

const PRESETS: Record<FunPreset, Partial<PickFilter>> = {
	'movie-night': { type: 'movie', runtimeMax: 150, ratingMin: 6 },
	'quick-watch': { type: 'movie', runtimeMax: 100 },
	acclaimed: { ratingMin: 8 },
	'fresh-unwatched': { addedWithinDays: 90, excludeWatched: true }
};

function safeText(value: string | null, maxLength: number): string | undefined {
	const normalized = value?.trim();
	return normalized && normalized.length <= maxLength ? normalized : undefined;
}

function parseBoundedNumber(
	raw: string | null,
	field: PickFilterField,
	errors: ParsedPickFilter['errors'],
	min: number,
	max: number,
	integer = true
): number | undefined {
	if (raw === null || raw.trim() === '') return undefined;
	const value = Number(raw);
	if (!Number.isFinite(value) || (integer && !Number.isInteger(value))) {
		errors[field] = 'invalid';
		return undefined;
	}
	if (value < min || value > max) {
		errors[field] = 'out_of_range';
		return undefined;
	}
	return value;
}

function parsePreset(raw: string | null): FunPreset | undefined {
	return raw && Object.hasOwn(PRESETS, raw) ? (raw as FunPreset) : undefined;
}

function parseMode(raw: string | null, errors: ParsedPickFilter['errors']): FunRevealMode {
	if (!raw || raw === 'standard') return 'standard';
	if (raw === 'blind' || raw === 'capsule') return raw;
	errors.mode = 'invalid';
	return 'standard';
}

function parseExcludeIds(raw: string | null, errors: ParsedPickFilter['errors']): number[] {
	if (!raw) return [];
	const ids: number[] = [];
	for (const part of raw.split(',')) {
		const id = Number(part);
		if (!Number.isSafeInteger(id) || id <= 0) {
			errors.exclude = 'invalid';
			continue;
		}
		if (!ids.includes(id)) ids.push(id);
		if (ids.length === FUN_MAX_RECENT_EXCLUSIONS) break;
	}
	return ids;
}

/** Parse and validate all reusable FUN filters from a shareable query string. */
export function validatePickFilter(
	params: URLSearchParams,
	options: { currentYear?: number } = {}
): ParsedPickFilter {
	const errors: ParsedPickFilter['errors'] = {};
	const currentYear = options.currentYear ?? new Date().getUTCFullYear();
	const preset = parsePreset(params.get('preset'));
	const presetDefaults = preset ? PRESETS[preset] : {};
	const rawType = params.get('type');
	let type = presetDefaults.type;
	if (rawType !== null && rawType !== '') {
		if (rawType === 'movie' || rawType === 'show') type = rawType;
		else errors.type = 'invalid';
	}

	const yearMin =
		parseBoundedNumber(params.get('yearMin'), 'yearMin', errors, 1870, currentYear + 5) ??
		presetDefaults.yearMin;
	const yearMax =
		parseBoundedNumber(params.get('yearMax'), 'yearMax', errors, 1870, currentYear + 5) ??
		presetDefaults.yearMax;
	const runtimeMin =
		parseBoundedNumber(params.get('runtimeMin'), 'runtimeMin', errors, 1, 1000) ??
		presetDefaults.runtimeMin;
	const runtimeMax =
		parseBoundedNumber(params.get('runtimeMax'), 'runtimeMax', errors, 1, 1000) ??
		presetDefaults.runtimeMax;
	const ratingMin =
		parseBoundedNumber(params.get('ratingMin'), 'ratingMin', errors, 0, 10, false) ??
		presetDefaults.ratingMin;
	const addedWithinDays =
		parseBoundedNumber(params.get('addedWithinDays'), 'addedWithinDays', errors, 1, 3650) ??
		presetDefaults.addedWithinDays;

	if (yearMin !== undefined && yearMax !== undefined && yearMin > yearMax) {
		errors.yearMin = 'min_greater_than_max';
	}
	if (runtimeMin !== undefined && runtimeMax !== undefined && runtimeMin > runtimeMax) {
		errors.runtimeMin = 'min_greater_than_max';
	}

	const rawCount = params.get('count');
	const parsedCount = parseBoundedNumber(rawCount, 'count', errors, 1, FUN_MAX_CHOICES);
	const count = (parsedCount ?? 1) as 1 | 2 | 3;
	const rawSeed = params.get('seed');
	let seed: string | undefined;
	if (rawSeed) {
		seed = /^[A-Za-z0-9_-]{1,64}$/.test(rawSeed) ? rawSeed : undefined;
		if (!seed) errors.seed = 'invalid';
	}

	const serverInstanceId = safeText(params.get('server'), 128);
	if (params.get('server') && !serverInstanceId) errors.server = 'invalid';
	const librarySectionKey = safeText(params.get('library'), 256);
	if (params.get('library') && !librarySectionKey) errors.library = 'invalid';

	return {
		filter: {
			serverInstanceId,
			librarySectionKey,
			type,
			genre: safeText(params.get('genre'), 128),
			yearMin,
			yearMax,
			runtimeMin,
			runtimeMax,
			ratingMin,
			addedWithinDays,
			excludeWatched:
				params.get('excludeWatched') === '1' || presetDefaults.excludeWatched === true,
			preset,
			count,
			seed,
			excludeItemIds: parseExcludeIds(params.get('exclude'), errors),
			mode: parseMode(params.get('mode'), errors)
		},
		errors
	};
}

/** Backwards-compatible convenience for callers that only need normalized criteria. */
export function parsePickFilter(params: URLSearchParams): PickFilter {
	return validatePickFilter(params).filter;
}
