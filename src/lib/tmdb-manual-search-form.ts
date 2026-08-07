export type ManualTmdbSearchType = 'movie' | 'tv' | 'both';

export interface ManualTmdbSearchFormInput {
	query: string;
	year: number | null;
	mediaType: ManualTmdbSearchType;
}

/** A user-correctable manual TMDB search form error. */
export class ManualTmdbSearchValidationError extends Error {
	constructor() {
		super('invalid_manual_tmdb_search');
		this.name = 'ManualTmdbSearchValidationError';
	}
}

/** Keep an optional number input in the form's number-or-empty domain. */
export function readManualTmdbSearchYear(value: string, valueAsNumber: number): number | null {
	return value === '' ? null : valueAsNumber;
}

/** Validate and serialize the values currently shown by the manual-match form. */
export function prepareManualTmdbSearchParams(input: ManualTmdbSearchFormInput): URLSearchParams {
	const query = input.query.normalize('NFKC').trim().replace(/\s+/gu, ' ');
	if (query.length === 0 || query.length > 200 || /[\p{Cc}\p{Cf}]/u.test(query)) {
		throw new ManualTmdbSearchValidationError();
	}
	if (
		input.year !== null &&
		(!Number.isInteger(input.year) || input.year < 1800 || input.year > 9999)
	) {
		throw new ManualTmdbSearchValidationError();
	}
	if (input.mediaType !== 'movie' && input.mediaType !== 'tv' && input.mediaType !== 'both') {
		throw new ManualTmdbSearchValidationError();
	}

	const params = new URLSearchParams({ q: query, type: input.mediaType });
	if (input.year !== null) params.set('year', String(input.year));
	return params;
}
