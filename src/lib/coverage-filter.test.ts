import { describe, expect, it } from 'vitest';
import {
	COVERAGE_FILTER_PARAM,
	COVERAGE_FILTER_VALUES,
	parseCoverageFilter,
	serializeCoverageFilter
} from './coverage-filter';

describe('parseCoverageFilter', () => {
	it('adds no coverage predicate when the parameter is absent', () => {
		expect(parseCoverageFilter(new URLSearchParams())).toBeUndefined();
		expect(parseCoverageFilter(new URLSearchParams({ q: 'Arrival' }))).toBeUndefined();
	});

	it('falls back to showing everything for a value it does not recognize', () => {
		// A stale bookmark or a hand-typed guess must widen to the whole list, never
		// narrow it to nothing: an unexplained empty library is indistinguishable
		// from a broken one.
		for (const raw of ['', ' ', 'applied', 'covered', 'APPLIED_ON_THIS_SERVER', '1']) {
			expect(parseCoverageFilter(new URLSearchParams({ [COVERAGE_FILTER_PARAM]: raw }))).toBe(
				undefined
			);
		}
	});

	it('rejects raw coverage statuses that are not filterable questions', () => {
		// `missing` and `applied_on_server` are statuses of one slot at one
		// destination. Accepting them here would silently filter by something the
		// control cannot express and the label cannot describe.
		for (const status of ['applied_on_server', 'recorded_unverified', 'missing']) {
			expect(parseCoverageFilter(new URLSearchParams({ [COVERAGE_FILTER_PARAM]: status }))).toBe(
				undefined
			);
		}
	});

	it('round-trips every supported filter through the URL', () => {
		for (const value of COVERAGE_FILTER_VALUES) {
			const params = new URLSearchParams();
			const serialized = serializeCoverageFilter(value);
			expect(serialized).toBe(value);
			params.set(COVERAGE_FILTER_PARAM, serialized as string);
			expect(parseCoverageFilter(params)).toBe(value);
		}
	});
});

describe('serializeCoverageFilter', () => {
	it('drops the parameter for "any coverage" so the unfiltered list has one URL', () => {
		expect(serializeCoverageFilter('')).toBeUndefined();
		expect(serializeCoverageFilter(null)).toBeUndefined();
		expect(serializeCoverageFilter(undefined)).toBeUndefined();
	});

	it('drops a value the parse would refuse, so a control cannot write one', () => {
		expect(serializeCoverageFilter('needs_art')).toBeUndefined();
		expect(serializeCoverageFilter('missing')).toBeUndefined();
	});
});
