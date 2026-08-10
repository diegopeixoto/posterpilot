import { describe, expect, it } from 'vitest';
import { describeErrorChain, formatRequestError } from './error-detail';

/** The shape drizzle produces: a wrapper whose `cause` carries the real reason. */
function drizzleError(cause: unknown): Error {
	const error = new Error(
		'Failed query: select "key", "value" from "settings"\nparams: authMode,1'
	);
	error.name = 'DrizzleQueryError';
	error.cause = cause;
	return error;
}

function libsqlError(message: string, code: string, rawCode?: number): Error {
	const error = new Error(message);
	error.name = 'LibsqlError';
	Object.assign(error, { code, rawCode });
	return error;
}

describe('describeErrorChain', () => {
	it('recovers the SQLite code drizzle buries on the cause', () => {
		const chain = describeErrorChain(
			drizzleError(libsqlError('database is locked', 'SQLITE_BUSY', 5))
		);
		expect(chain).toContain('DrizzleQueryError');
		expect(chain).toContain('code=SQLITE_BUSY');
		expect(chain).toContain('rawCode=5');
	});

	it('keeps an empty code visible rather than dropping it', () => {
		// A failure to open a connection reports `code: ''`, and the reason is only in
		// the message. Rendering nothing here would make it indistinguishable from an
		// error carrying no code at all — the exact ambiguity this exists to remove.
		const chain = describeErrorChain(
			drizzleError(libsqlError('ConnectionFailed("Unable to open connection …: 14")', ''))
		);
		expect(chain).toContain('code=(empty)');
		expect(chain).toContain('Unable to open connection');
	});

	it('collapses the multi-line query into a single line', () => {
		expect(describeErrorChain(drizzleError(new Error('boom')))).not.toContain('\n');
	});

	it('terminates on a cause cycle instead of spinning', () => {
		const outer = new Error('outer');
		const inner = new Error('inner');
		outer.cause = inner;
		inner.cause = outer;
		const chain = describeErrorChain(outer);
		expect(chain).toBe('Error: outer <- Error: inner');
	});

	it('describes a non-Error rejection', () => {
		expect(describeErrorChain('plain string')).toBe('plain string');
	});
});

describe('formatRequestError', () => {
	it('keeps the stack, so an ordinary runtime error still points at its line', () => {
		// The whole reason this module exists is diagnosability; dropping the stack
		// would fix it for database errors and break it for every other kind.
		const error = new TypeError('x is not a function');
		const output = formatRequestError(error, 'GET', '/api/health');
		expect(output).toContain('[error] GET /api/health');
		expect(output).toContain('TypeError');
		expect(output).toContain('error-detail.test.ts');
	});

	it('carries both the buried cause and the stack for a wrapped query failure', () => {
		const output = formatRequestError(
			drizzleError(libsqlError('database is locked', 'SQLITE_BUSY', 5)),
			'GET',
			'/'
		);
		expect(output).toContain('code=SQLITE_BUSY');
		expect(output.split('\n')[0]).toContain('[error] GET /');
		expect(output.split('\n').length).toBeGreaterThan(1);
	});

	it('degrades to the summary alone when what was thrown has no stack', () => {
		expect(formatRequestError('nope', 'POST', '/api/apply')).toBe('[error] POST /api/apply — nope');
	});
});
