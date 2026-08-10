import { describe, expect, it } from 'vitest';
import {
	canonicalIdentityKey,
	COVERAGE_STATUSES,
	isCovered,
	isIndeterminate,
	isStatusValidForDestination
} from '$lib/artwork-coverage';

describe('canonicalIdentityKey', () => {
	it('relates copies of one title across servers and libraries', () => {
		expect(canonicalIdentityKey('movie', '105')).toBe('movie:105');
		expect(canonicalIdentityKey('movie', 105)).toBe('movie:105');
	});

	it('never lets a movie and a show share the same number', () => {
		// TMDB numbers movies and shows independently, so these are different
		// titles that must not share coverage.
		expect(canonicalIdentityKey('movie', '105')).not.toBe(canonicalIdentityKey('tv', '105'));
	});

	it('returns null for an unresolved item so nothing relates by title', () => {
		expect(canonicalIdentityKey(null, '105')).toBeNull();
		expect(canonicalIdentityKey('movie', null)).toBeNull();
		expect(canonicalIdentityKey(undefined, undefined)).toBeNull();
	});

	it('rejects identifiers that are not plainly numeric', () => {
		for (const id of ['', '  ', 'abc', '10a', '../7', '1.5']) {
			expect(canonicalIdentityKey('movie', id)).toBeNull();
		}
	});
});

describe('isStatusValidForDestination', () => {
	it('never lets a Kometa export claim a server apply', () => {
		// A metadata file on disk proves nothing about what a media server is
		// serving. Collapsing these would tell someone their artwork is live when
		// only a YAML entry exists.
		expect(isStatusValidForDestination('kometa', 'applied_on_server')).toBe(false);
		expect(isStatusValidForDestination('server', 'exported_to_kometa')).toBe(false);
	});

	it('accepts each destination its own evidence', () => {
		expect(isStatusValidForDestination('server', 'applied_on_server')).toBe(true);
		expect(isStatusValidForDestination('server', 'externally_changed')).toBe(true);
		expect(isStatusValidForDestination('kometa', 'exported_to_kometa')).toBe(true);
	});

	it('allows missing and unknown at either destination', () => {
		for (const destination of ['server', 'kometa'] as const) {
			expect(isStatusValidForDestination(destination, 'missing')).toBe(true);
			expect(isStatusValidForDestination(destination, 'unknown')).toBe(true);
		}
	});
});

describe('coverage status semantics', () => {
	it('treats only positive proof as covered', () => {
		expect(isCovered('applied_on_server')).toBe(true);
		expect(isCovered('exported_to_kometa')).toBe(true);
		for (const status of [
			'recorded_unverified',
			'externally_changed',
			'missing',
			'unknown'
		] as const) {
			expect(isCovered(status)).toBe(false);
		}
	});

	it('separates "could not tell" from "checked and absent"', () => {
		// A failed or unparseable read must never read as missing: that would mark
		// a covered library uncovered on the strength of an I/O error.
		expect(isIndeterminate('unknown')).toBe(true);
		expect(isIndeterminate('recorded_unverified')).toBe(true);
		expect(isIndeterminate('missing')).toBe(false);
	});

	it('classifies every declared status into exactly one outcome', () => {
		// Four outcomes, not three: `externally_changed` is firm knowledge that
		// something replaced our artwork, which is neither an absence nor a gap in
		// evidence, and the UI has to be able to say so distinctly.
		for (const status of COVERAGE_STATUSES) {
			const buckets = [
				isCovered(status),
				isIndeterminate(status),
				status === 'externally_changed',
				status === 'missing'
			].filter(Boolean);
			expect(buckets, `status ${status} must land in exactly one outcome`).toHaveLength(1);
		}
	});
});
