export type ApiErrorParameter = string | number | boolean | null;

export interface LocaleNeutralApiError {
	code: string;
	params: Record<string, ApiErrorParameter>;
	correlationId: string | null;
}

export interface ApiErrorLocalizers {
	known: Readonly<
		Record<string, ((params: Readonly<Record<string, ApiErrorParameter>>) => string) | undefined>
	>;
	generic: () => string;
	reference: (params: { id: string }) => string;
}

export interface LocalizedApiError extends LocaleNeutralApiError {
	message: string;
	reference: string | null;
}

const CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const PARAMETER_PATTERN = /^[a-z][a-zA-Z0-9_]{0,63}$/;
const CORRELATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

function record(value: unknown): Record<string, unknown> | null {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function safeCorrelationId(value: unknown): string | null {
	return typeof value === 'string' && CORRELATION_PATTERN.test(value) ? value : null;
}

function safeParameters(value: unknown): Record<string, ApiErrorParameter> {
	const source = record(value);
	if (!source) return {};
	const output: Record<string, ApiErrorParameter> = {};
	for (const [key, parameter] of Object.entries(source).slice(0, 16)) {
		if (!PARAMETER_PATTERN.test(key)) continue;
		if (parameter === null || typeof parameter === 'number' || typeof parameter === 'boolean') {
			output[key] = parameter;
		} else if (typeof parameter === 'string' && parameter.length <= 200) {
			output[key] = parameter;
		}
	}
	return output;
}

/**
 * Parse the stable, locale-neutral part of an API failure. Free-form strings and
 * unsafe identifiers are deliberately collapsed to `unknown_error`/null so raw
 * upstream or database details never become user-facing fallback copy.
 */
export function readLocaleNeutralApiError(value: unknown): LocaleNeutralApiError {
	const body = record(value);
	const error = body?.error;
	const structured = record(error);
	const rawCode = typeof error === 'string' ? error : structured?.code;
	const code =
		typeof rawCode === 'string' && CODE_PATTERN.test(rawCode) ? rawCode : 'unknown_error';
	return {
		code,
		params: safeParameters(structured?.params),
		correlationId: safeCorrelationId(structured?.correlationId ?? body?.correlationId)
	};
}

/** Translate a parsed API code at render time, with a safe generic fallback. */
export function localizeApiError(
	value: unknown,
	localizers: ApiErrorLocalizers
): LocalizedApiError {
	const parsed = readLocaleNeutralApiError(value);
	const renderKnown = localizers.known[parsed.code];
	let message: string;
	let knownRendered = false;
	try {
		if (renderKnown) {
			message = renderKnown(parsed.params);
			knownRendered = true;
		} else {
			message = localizers.generic();
		}
	} catch {
		message = localizers.generic();
	}
	return {
		...parsed,
		params: knownRendered ? parsed.params : {},
		message,
		reference: parsed.correlationId ? localizers.reference({ id: parsed.correlationId }) : null
	};
}
