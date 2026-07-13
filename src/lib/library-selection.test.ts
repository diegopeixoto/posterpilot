import { describe, expect, it } from 'vitest';
import { fingerprintLibrarySelection } from './library-selection';

describe('library all-results fingerprint', () => {
	it('is stable for the same normalized filter and ordered ids', () => {
		const input = {
			serverInstanceId: 'server-a',
			filter: { type: 'movie' as const, hasCandidates: true, sort: 'title' as const },
			effectiveSort: 'title' as const,
			orderedItemIds: [1, 2, 3]
		};
		expect(fingerprintLibrarySelection(input)).toBe(fingerprintLibrarySelection({ ...input }));
	});

	it('changes with server, filter, order, or membership', () => {
		const base = {
			serverInstanceId: 'server-a',
			filter: {},
			effectiveSort: 'title' as const,
			orderedItemIds: [1, 2]
		};
		const fingerprint = fingerprintLibrarySelection(base);
		expect(fingerprintLibrarySelection({ ...base, serverInstanceId: 'server-b' })).not.toBe(
			fingerprint
		);
		expect(fingerprintLibrarySelection({ ...base, filter: { q: 'Alien' } })).not.toBe(fingerprint);
		expect(fingerprintLibrarySelection({ ...base, orderedItemIds: [2, 1] })).not.toBe(fingerprint);
	});
});
