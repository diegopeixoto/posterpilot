import { describe, expect, it } from 'vitest';
import {
	coverageOccurrenceKey,
	groupOccurrencesByIdentity,
	isActiveOccurrence,
	toCoverageOccurrence,
	type CoverageOccurrenceInput
} from './occurrences';

function row(overrides: Partial<CoverageOccurrenceInput> = {}): CoverageOccurrenceInput {
	return {
		serverInstanceId: 'plex-1',
		mediaItemId: 1,
		librarySectionKey: 'movies',
		mediaType: 'movie',
		tmdbId: '105',
		...overrides
	};
}

describe('canonical occurrence grouping', () => {
	it('relates the same title in two libraries while keeping both provenances', () => {
		const groups = groupOccurrencesByIdentity([
			row({ mediaItemId: 1, librarySectionKey: 'movies' }),
			row({ mediaItemId: 2, librarySectionKey: 'movies-4k' })
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0].key).toBe('movie:105');
		expect(groups[0].resolved).toBe(true);
		expect(groups[0].libraryCount).toBe(2);
		expect(groups[0].occurrences.map((o) => o.librarySectionKey)).toEqual(['movies', 'movies-4k']);
		expect(groups[0].occurrences.map((o) => o.mediaItemId)).toEqual([1, 2]);
	});

	it('relates the same title across servers and reports each server', () => {
		const groups = groupOccurrencesByIdentity([
			row({ serverInstanceId: 'plex-1', mediaItemId: 1 }),
			row({ serverInstanceId: 'jellyfin-1', mediaItemId: 1 })
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0].serverInstanceIds).toEqual(['jellyfin-1', 'plex-1']);
		expect(groups[0].libraryCount).toBe(2);
	});

	it('keeps a movie and a show with the same numeric id apart', () => {
		const groups = groupOccurrencesByIdentity([
			row({ mediaItemId: 1, mediaType: 'movie', tmdbId: '105' }),
			row({ mediaItemId: 2, mediaType: 'tv', tmdbId: '105', librarySectionKey: 'shows' })
		]);

		expect(groups.map((group) => group.key)).toEqual(['movie:105', 'tv:105']);
		expect(groups.every((group) => group.occurrences.length === 1)).toBe(true);
	});

	it('gives every unresolved item a group of its own', () => {
		const groups = groupOccurrencesByIdentity([
			row({ mediaItemId: 1, mediaType: null, tmdbId: null }),
			row({ mediaItemId: 2, mediaType: null, tmdbId: null })
		]);

		expect(groups).toHaveLength(2);
		expect(groups.every((group) => group.resolved === false)).toBe(true);
		expect(groups.every((group) => group.kind === null && group.tmdbId === null)).toBe(true);
		expect(groups.map((group) => group.occurrences.length)).toEqual([1, 1]);
	});

	it('does not relate an unresolved item to a resolved one, or to a half-resolved one', () => {
		const groups = groupOccurrencesByIdentity([
			row({ mediaItemId: 1, mediaType: 'movie', tmdbId: '105' }),
			// Same title and year in the source library, but no resolved identity.
			row({ mediaItemId: 2, mediaType: null, tmdbId: '105' }),
			row({ mediaItemId: 3, mediaType: 'movie', tmdbId: null })
		]);

		expect(groups).toHaveLength(3);
		expect(groups.filter((group) => group.resolved)).toHaveLength(1);
	});

	it('rejects a non-numeric TMDB id rather than keying on it', () => {
		const [group] = groupOccurrencesByIdentity([row({ tmdbId: 'tt0111161' })]);
		expect(group.resolved).toBe(false);
	});

	it('excludes copies that no longer exist in their library', () => {
		const groups = groupOccurrencesByIdentity([
			row({ mediaItemId: 1 }),
			row({ mediaItemId: 2, sourceRemovedAt: new Date('2026-01-01T00:00:00Z') })
		]);

		expect(groups).toHaveLength(1);
		expect(groups[0].occurrences).toHaveLength(1);
		expect(groups[0].libraryCount).toBe(1);
	});

	it('collapses a repeated row for one server and media item', () => {
		const groups = groupOccurrencesByIdentity([row(), row()]);
		expect(groups[0].occurrences).toHaveLength(1);
	});

	it('keeps occurrence keys unambiguous when a server id contains the delimiter', () => {
		expect(coverageOccurrenceKey('a:1', 2)).not.toBe(coverageOccurrenceKey('a', '1:2' as never));
		expect(toCoverageOccurrence(row()).occurrenceKey).toBe(coverageOccurrenceKey('plex-1', 1));
	});

	it('treats a null or absent removal timestamp as active', () => {
		expect(isActiveOccurrence(row())).toBe(true);
		expect(isActiveOccurrence(row({ sourceRemovedAt: null }))).toBe(true);
		expect(isActiveOccurrence(row({ sourceRemovedAt: new Date() }))).toBe(false);
	});
});
