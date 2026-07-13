export const SUPPORT_REDACTION = '<redacted>';

import {
	containsSensitiveText,
	isSecretLikeKey,
	redactSensitiveText
} from '$lib/server/sensitive-redaction';

export class UnsafeSupportEntryError extends Error {
	constructor(public readonly reason: 'cyclic' | 'unsupported' | 'sanitization_uncertain') {
		super(reason);
		this.name = 'UnsafeSupportEntryError';
	}
}

function redactString(value: string, secrets: readonly string[]): string {
	return redactSensitiveText(value, SUPPORT_REDACTION, secrets);
}

function sanitizeValue(value: unknown, secrets: readonly string[], seen: WeakSet<object>): unknown {
	if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
	if (typeof value === 'string') return redactString(value, secrets);
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'undefined') return null;
	if (typeof value === 'function' || typeof value === 'symbol') {
		throw new UnsafeSupportEntryError('unsupported');
	}
	if (value instanceof Date) return value.toISOString();
	if (value instanceof Error) {
		return {
			name: redactString(value.name, secrets),
			message: redactString(value.message, secrets)
		};
	}
	if (typeof value !== 'object') throw new UnsafeSupportEntryError('unsupported');
	if (seen.has(value)) throw new UnsafeSupportEntryError('cyclic');
	seen.add(value);
	try {
		if (Array.isArray(value)) return value.map((entry) => sanitizeValue(entry, secrets, seen));
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new UnsafeSupportEntryError('unsupported');
		}
		const output: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(value)) {
			if (isSecretLikeKey(key)) {
				output[key] =
					entry === null || entry === '' || entry === false ? '<unset>' : SUPPORT_REDACTION;
				continue;
			}
			output[key] = sanitizeValue(entry, secrets, seen);
		}
		return output;
	} finally {
		seen.delete(value);
	}
}

function stillContainsCredential(serialized: string, secrets: readonly string[]): boolean {
	const withoutMarkers = serialized.replaceAll(SUPPORT_REDACTION, '');
	return containsSensitiveText(withoutMarkers, secrets);
}

/** Deeply sanitize a JSON entry and refuse it when safety cannot be established. */
export function sanitizeSupportEntry(value: unknown, secrets: readonly string[] = []): unknown {
	const sanitized = sanitizeValue(value, secrets.filter(Boolean), new WeakSet());
	let serialized: string;
	try {
		serialized = JSON.stringify(sanitized);
	} catch {
		throw new UnsafeSupportEntryError('unsupported');
	}
	if (stillContainsCredential(serialized, secrets)) {
		throw new UnsafeSupportEntryError('sanitization_uncertain');
	}
	return sanitized;
}
