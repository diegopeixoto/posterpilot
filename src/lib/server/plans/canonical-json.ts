import { createHash } from 'node:crypto';

export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

/** Raised when a value cannot be represented as unambiguous canonical JSON. */
export class CanonicalJsonError extends TypeError {
	constructor(
		message: string,
		readonly path: string
	) {
		super(`${message} at ${path}`);
		this.name = 'CanonicalJsonError';
	}
}

function childPath(parent: string, key: string): string {
	return /^[A-Za-z_$][\w$]*$/.test(key) ? `${parent}.${key}` : `${parent}[${JSON.stringify(key)}]`;
}

function canonicalize(value: unknown, path: string, ancestors: Set<object>): string {
	if (value === null) return 'null';

	switch (typeof value) {
		case 'boolean':
			return value ? 'true' : 'false';
		case 'number':
			if (!Number.isFinite(value)) {
				throw new CanonicalJsonError('Non-finite numbers are not valid JSON', path);
			}
			// JSON.stringify supplies the ECMAScript JSON number representation, including
			// the canonical normalization of negative zero to zero.
			return JSON.stringify(value);
		case 'string':
			return JSON.stringify(value);
		case 'undefined':
		case 'bigint':
		case 'function':
		case 'symbol':
			throw new CanonicalJsonError(`Values of type ${typeof value} are not valid JSON`, path);
		case 'object':
			break;
	}

	if (ancestors.has(value)) {
		throw new CanonicalJsonError('Circular references are not valid JSON', path);
	}

	ancestors.add(value);
	try {
		if (Array.isArray(value)) {
			const entries: string[] = [];
			for (let index = 0; index < value.length; index += 1) {
				if (!Object.hasOwn(value, index)) {
					throw new CanonicalJsonError(
						'Sparse arrays are not valid JSON values',
						`${path}[${index}]`
					);
				}
				entries.push(canonicalize(value[index], `${path}[${index}]`, ancestors));
			}
			return `[${entries.join(',')}]`;
		}

		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw new CanonicalJsonError('Only plain objects can be canonicalized as JSON', path);
		}

		const symbolKey = Reflect.ownKeys(value).find((key) => typeof key === 'symbol');
		if (symbolKey !== undefined) {
			throw new CanonicalJsonError('Symbol-keyed properties are not valid JSON', path);
		}

		const entries = Object.keys(value)
			.sort()
			.map((key) => {
				const serialized = canonicalize(
					(value as Record<string, unknown>)[key],
					childPath(path, key),
					ancestors
				);
				return `${JSON.stringify(key)}:${serialized}`;
			});
		return `{${entries.join(',')}}`;
	} finally {
		ancestors.delete(value);
	}
}

/**
 * Serialize a JSON value deterministically: object keys are recursively sorted,
 * arrays retain their order, and no insignificant whitespace is emitted.
 *
 * Invalid JSON-domain values are rejected instead of being silently omitted or
 * coerced, ensuring two different operation plans cannot accidentally share a
 * digest because of `JSON.stringify`'s undefined/non-finite fallbacks.
 */
export function canonicalJson(value: unknown): string {
	return canonicalize(value, '$', new Set());
}

/** Return a lowercase SHA-256 digest of already-canonical UTF-8 JSON text. */
export function hashCanonicalJsonText(canonical: string): string {
	return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Canonicalize a JSON value and return both the persisted text and its digest. */
export function canonicalJsonDigest(value: unknown): { canonicalJson: string; digest: string } {
	const canonical = canonicalJson(value);
	return { canonicalJson: canonical, digest: hashCanonicalJsonText(canonical) };
}

/** Return the digest of a JSON value's deterministic canonical representation. */
export function hashCanonicalJson(value: unknown): string {
	return canonicalJsonDigest(value).digest;
}
