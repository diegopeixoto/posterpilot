import { describe, expect, it, vi } from 'vitest';

/**
 * Messages are mocked to their own key plus the parameters they were handed, so a
 * test can pin *which* catalog entry a status renders. That is the point: the
 * English wording encodes decisions — `missing` is "Not applied by PosterPilot",
 * not "no artwork" — and a swap to a friendlier-sounding key would otherwise pass
 * every assertion about non-empty text.
 */
vi.mock('$lib/paraglide/messages', () => ({
	m: new Proxy(
		{},
		{
			get:
				(_target, key) =>
				(params?: Record<string, unknown>): string => {
					if (!params) return String(key);
					const args = Object.entries(params).map(([name, value]) => `${name}=${value}`);
					return `${String(key)}(${args.join(',')})`;
				}
		}
	)
}));

import { COVERAGE_STATUSES, type CoverageStatus } from './artwork-coverage';
import {
	COVERAGE_TONES,
	coverageBreakdown,
	coverageDestinationLabel,
	coverageOccurrenceReport,
	coverageSlotLabel,
	coverageStatusLabel,
	coverageStatusPresentation,
	type CoverageSlotEvidence
} from './coverage-presentation';

function slot(overrides: Partial<CoverageSlotEvidence> = {}): CoverageSlotEvidence {
	return {
		destination: 'server',
		kind: 'poster',
		season: null,
		episode: null,
		status: 'applied_on_server',
		...overrides
	};
}

describe('coverage status presentation', () => {
	// Exhaustive over the exported tuple rather than a hand-written list, so a status
	// added to the shared vocabulary cannot ship with no label.
	it('gives every status a label, an icon, and a known tone', () => {
		for (const status of COVERAGE_STATUSES) {
			const presentation = coverageStatusPresentation(status);
			expect(presentation.status).toBe(status);
			expect(presentation.label.trim()).not.toBe('');
			expect(presentation.icon.trim()).not.toBe('');
			expect(COVERAGE_TONES).toContain(presentation.tone);
		}
	});

	it('never lets two statuses share a label or an icon', () => {
		const labels = COVERAGE_STATUSES.map((status) => coverageStatusLabel(status));
		const icons = COVERAGE_STATUSES.map((status) => coverageStatusPresentation(status).icon);
		// Tones are allowed to repeat; the text and the glyph are what carry the
		// verdict when colour is unavailable, so those must stay distinct.
		expect(new Set(labels).size).toBe(COVERAGE_STATUSES.length);
		expect(new Set(icons).size).toBe(COVERAGE_STATUSES.length);
	});

	it('renders each status from the catalog entry whose wording it depends on', () => {
		const expected: Record<CoverageStatus, string> = {
			applied_on_server: 'coverage_status_applied_server',
			exported_to_kometa: 'coverage_status_exported_kometa',
			externally_changed: 'coverage_status_externally_changed',
			recorded_unverified: 'coverage_status_unverified',
			// "Not applied by PosterPilot". A hand-set poster in Plex is `missing` here
			// and still has artwork, so no key that says "no artwork" belongs on it.
			missing: 'coverage_status_missing',
			unknown: 'coverage_status_unknown'
		};
		for (const status of COVERAGE_STATUSES) {
			expect(coverageStatusLabel(status)).toBe(expected[status]);
		}
	});

	it('keeps a Kometa export out of the tone a verified server write earns', () => {
		expect(coverageStatusPresentation('applied_on_server').tone).toBe('covered');
		expect(coverageStatusPresentation('exported_to_kometa').tone).not.toBe('covered');
	});

	it('keeps an external change distinct from absence and from an unusable observation', () => {
		const changed = coverageStatusPresentation('externally_changed');
		expect(changed.tone).not.toBe(coverageStatusPresentation('missing').tone);
		expect(changed.tone).not.toBe(coverageStatusPresentation('unknown').tone);
		expect(changed.label).not.toBe(coverageStatusLabel('missing'));
	});

	it('names both destinations', () => {
		expect(coverageDestinationLabel('server')).toBe('coverage_destination_server');
		expect(coverageDestinationLabel('kometa')).toBe('coverage_destination_kometa');
	});
});

describe('coverage slot labels', () => {
	it('names a root slot by its artwork kind alone', () => {
		expect(coverageSlotLabel({ kind: 'poster' })).toBe('item_poster');
		expect(coverageSlotLabel({ kind: 'background' })).toBe('item_backdrop');
		expect(coverageSlotLabel({ kind: 'title_card' })).toBe('item_title_card');
	});

	it('scopes a season and an episode slot without losing the kind', () => {
		expect(coverageSlotLabel({ kind: 'poster', season: 2 })).toBe(
			'jobs_slot_scope_season(kind=item_poster,season=2)'
		);
		expect(coverageSlotLabel({ kind: 'title_card', season: 2, episode: 4 })).toBe(
			'jobs_slot_scope_episode(kind=item_title_card,season=2,episode=4)'
		);
	});

	it('treats season 0 as specials rather than as no season', () => {
		expect(coverageSlotLabel({ kind: 'poster', season: 0 })).toBe(
			'jobs_slot_scope_season(kind=item_poster,season=0)'
		);
	});

	it('falls back to a generic artwork name instead of showing a machine code', () => {
		expect(coverageSlotLabel({ kind: 'future_kind' })).toBe('jobs_slot_other');
	});
});

describe('coverage breakdown', () => {
	it('reports each destination and slot independently, never one verdict', () => {
		const report = coverageBreakdown([
			slot({ kind: 'poster', status: 'applied_on_server' }),
			slot({ kind: 'background', status: 'applied_on_server' }),
			slot({ destination: 'kometa', kind: 'poster', status: 'exported_to_kometa' }),
			slot({ destination: 'kometa', kind: 'background', status: 'missing' })
		]);

		const [server, kometa] = report;
		expect(server.destination).toBe('server');
		expect(kometa.destination).toBe('kometa');
		// The scenario the requirement names: verified on the server, exported for only
		// some slots. Two destinations, four slots, four statuses — and no total.
		expect(server.covered).toBe(2);
		expect(server.observed).toBe(2);
		expect(kometa.covered).toBe(1);
		expect(kometa.observed).toBe(2);
		expect(kometa.slots.map((entry) => entry.status)).toEqual(['exported_to_kometa', 'missing']);
		expect(report).toHaveLength(2);
	});

	it('never promotes a Kometa export into an applied-on-server status', () => {
		const [, kometa] = coverageBreakdown([
			slot({ destination: 'kometa', status: 'exported_to_kometa' })
		]);
		expect(kometa.slots[0].status).toBe('exported_to_kometa');
		expect(kometa.slots[0].presentation.label).toBe('coverage_status_exported_kometa');
		// Writing the file proves nothing about Kometa having run, so the caveat rides
		// along with the badge rather than being left to the reader to infer.
		expect(kometa.note).toBe('coverage_kometa_not_applied');
	});

	it('carries the Kometa caveat only where something is actually exported', () => {
		const [server, kometa] = coverageBreakdown([
			slot({ status: 'applied_on_server' }),
			slot({ destination: 'kometa', status: 'missing' })
		]);
		expect(server.note).toBeNull();
		expect(kometa.note).toBeNull();
	});

	it('still lists a destination that has no evidence at all', () => {
		const [server, kometa] = coverageBreakdown([slot({ status: 'applied_on_server' })]);
		expect(server.empty).toBe(false);
		// A destination that vanishes when empty is one the reader never learns to ask
		// about — and its absence would read as coverage rather than as nothing written.
		expect(kometa.empty).toBe(true);
		expect(kometa.slots).toEqual([]);
		expect(kometa.covered).toBe(0);
		expect(kometa.observed).toBe(0);
	});

	it('counts only the statuses the shared contract calls covered', () => {
		const [server] = coverageBreakdown([
			slot({ kind: 'poster', status: 'applied_on_server' }),
			slot({ kind: 'background', status: 'recorded_unverified' }),
			slot({ kind: 'title_card', season: 1, episode: 1, status: 'externally_changed' }),
			slot({ kind: 'poster', season: 1, status: 'unknown' })
		]);
		expect(server.observed).toBe(4);
		expect(server.covered).toBe(1);
	});

	it('orders root slots before season and episode slots', () => {
		const [server] = coverageBreakdown([
			slot({ kind: 'title_card', season: 1, episode: 2 }),
			slot({ kind: 'poster', season: 1 }),
			slot({ kind: 'background' }),
			slot({ kind: 'poster' })
		]);
		expect(server.slots.map((entry) => entry.key)).toEqual([
			'server:poster::',
			'server:background::',
			'server:poster:1:',
			'server:title_card:1:2'
		]);
	});

	it('orders episodes within a season and seasons within a title', () => {
		const [server] = coverageBreakdown([
			slot({ kind: 'title_card', season: 2, episode: 1 }),
			slot({ kind: 'title_card', season: 1, episode: 10 }),
			slot({ kind: 'title_card', season: 1, episode: 2 }),
			// Season 0 is specials and sorts as the season it is, not as a root slot.
			slot({ kind: 'poster', season: 0 })
		]);
		expect(server.slots.map((entry) => entry.key)).toEqual([
			'server:poster:0:',
			'server:title_card:1:2',
			'server:title_card:1:10',
			'server:title_card:2:1'
		]);
	});

	it('orders kinds it does not know rather than leaving them to insertion order', () => {
		// A kind the database grows later still has to render in a stable order, or the
		// same evidence would list differently on every load.
		const [server] = coverageBreakdown([
			slot({ kind: 'zeta_kind' }),
			slot({ kind: 'alpha_kind' }),
			slot({ kind: 'poster' })
		]);
		expect(server.slots.map((entry) => entry.key)).toEqual([
			'server:poster::',
			'server:alpha_kind::',
			'server:zeta_kind::'
		]);
	});
});

describe('coverage occurrence report', () => {
	it('reports the covered copies of a title that exists more than once', () => {
		const report = coverageOccurrenceReport({ occurrences: 3, coveredOccurrences: 2 });
		expect(report).toMatchObject({ covered: 2, total: 3, reportable: true });
		expect(report.label).toBe('coverage_occurrences(covered=2,total=3)');
	});

	it('stays quiet for a single copy, which has nothing to report across libraries', () => {
		expect(coverageOccurrenceReport({ occurrences: 1, coveredOccurrences: 0 }).reportable).toBe(
			false
		);
		expect(coverageOccurrenceReport({ occurrences: 1, coveredOccurrences: 1 }).reportable).toBe(
			false
		);
	});

	it('clamps a count that could not be true', () => {
		// Coverage and the occurrence count are read separately; a copy removed between
		// the two reads must not produce "3 of 2 copies covered".
		expect(coverageOccurrenceReport({ occurrences: 2, coveredOccurrences: 3 }).covered).toBe(2);
		expect(coverageOccurrenceReport({ occurrences: -1, coveredOccurrences: -4 })).toMatchObject({
			covered: 0,
			total: 0
		});
	});
});
