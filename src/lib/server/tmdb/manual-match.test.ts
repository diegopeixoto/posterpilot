import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	ManualMatchItem,
	ManualMatchRemote,
	ManualMatchRepository,
	ResolutionSummary
} from './manual-match';
import { ManualMatchError, createManualMatchService } from './manual-match';

const NOW = new Date('2026-07-10T18:00:00.000Z');

function item(overrides: Partial<ManualMatchItem> = {}): ManualMatchItem {
	return {
		id: 7,
		serverInstanceId: 'server-a',
		title: 'Old title',
		year: 2001,
		tmdbId: '100',
		imdbId: 'tt0000100',
		tvdbId: null,
		mediaType: 'movie',
		resolved: true,
		resolutionReason: 'imdb_id',
		manualMatchPinned: false,
		resolutionUpdatedAt: null,
		...overrides
	};
}

function summary(overrides: Partial<ResolutionSummary> = {}): ResolutionSummary {
	const source = item(overrides as Partial<ManualMatchItem>);
	return {
		id: source.id,
		serverInstanceId: source.serverInstanceId,
		tmdbId: source.tmdbId,
		mediaType: source.mediaType,
		resolved: source.resolved,
		resolutionReason: source.resolutionReason,
		manualMatchPinned: source.manualMatchPinned,
		resolutionUpdatedAt: source.resolutionUpdatedAt
	};
}

function fixture(current: ManualMatchItem | null = item()) {
	const repository = {
		getScopedItem: vi.fn(async () => current),
		pin: vi.fn(async () =>
			summary({
				tmdbId: '550',
				mediaType: 'movie',
				manualMatchPinned: true,
				resolutionReason: 'manual',
				resolutionUpdatedAt: NOW
			})
		),
		clear: vi.fn(async () =>
			summary({
				tmdbId: null,
				mediaType: null,
				resolved: false,
				manualMatchPinned: false,
				resolutionReason: 'manual_cleared',
				resolutionUpdatedAt: NOW
			})
		),
		applyAutomaticResolution: vi.fn(async () =>
			summary({
				tmdbId: '100',
				mediaType: 'movie',
				resolved: true,
				manualMatchPinned: false,
				resolutionReason: 'imdb_id'
			})
		),
		applyAutomaticUnresolved: vi.fn(async () =>
			summary({ tmdbId: null, mediaType: null, resolved: false, resolutionReason: 'no_match' })
		),
		listAudits: vi.fn(async () => [])
	} satisfies ManualMatchRepository;
	const remote = {
		search: vi.fn<ManualMatchRemote['search']>(async () => [
			{
				tmdbId: '550',
				mediaType: 'movie' as const,
				title: 'Fight Club',
				originalTitle: 'Fight Club',
				year: 1999,
				overview: null,
				posterUrl: null
			}
		]),
		verify: vi.fn<ManualMatchRemote['verify']>(async () => ({
			tmdbId: '550',
			mediaType: 'movie' as const,
			title: 'Fight Club',
			originalTitle: 'Fight Club',
			year: 1999,
			overview: null,
			posterUrl: null
		})),
		resolve: vi.fn<ManualMatchRemote['resolve']>(async () => ({
			tmdbId: '100',
			mediaType: 'movie' as const
		}))
	};
	return {
		repository,
		remote,
		service: createManualMatchService(repository, remote, { clock: () => new Date(NOW) })
	};
}

function expectNoMutation(repository: ReturnType<typeof fixture>['repository']) {
	expect(repository.pin).not.toHaveBeenCalled();
	expect(repository.clear).not.toHaveBeenCalled();
	expect(repository.applyAutomaticResolution).not.toHaveBeenCalled();
	expect(repository.applyAutomaticUnresolved).not.toHaveBeenCalled();
}

describe('manual TMDB match domain', () => {
	beforeEach(() => vi.clearAllMocks());

	it('searches without mutating resolution, candidates, or audit state', async () => {
		const { service, remote, repository } = fixture();
		await expect(
			service.search('server-a', 7, {
				query: '  Fight   Club ',
				year: 1999,
				mediaType: 'both',
				language: 'pt-BR'
			})
		).resolves.toHaveLength(1);
		expect(remote.search).toHaveBeenCalledWith({
			query: 'Fight Club',
			year: 1999,
			mediaType: 'both',
			language: 'pt-BR'
		});
		expectNoMutation(repository);
	});

	it('performs no mutation when remote candidate validation returns not found', async () => {
		const { service, remote, repository } = fixture();
		remote.verify.mockResolvedValue(null);

		await expect(
			service.confirm('server-a', 7, { tmdbId: '550', mediaType: 'movie' })
		).rejects.toMatchObject({
			code: 'tmdb_candidate_unavailable',
			message: 'tmdb_candidate_unavailable'
		});
		expectNoMutation(repository);
	});

	it('does not convert an upstream outage into a missing candidate or a write', async () => {
		const { service, remote, repository } = fixture();
		remote.verify.mockRejectedValue(new Error('HTTP 503 with sensitive URL'));
		await expect(
			service.confirm('server-a', 7, { tmdbId: '550', mediaType: 'movie' })
		).rejects.toMatchObject({ code: 'tmdb_unavailable' });
		expectNoMutation(repository);
	});

	it('pins only the exact remotely verified id and media type', async () => {
		const { service, repository, remote } = fixture();
		await service.confirm('server-a', 7, {
			tmdbId: '550',
			mediaType: 'movie',
			language: 'en'
		});
		expect(remote.verify).toHaveBeenCalledWith('550', 'movie', 'en');
		expect(repository.pin).toHaveBeenCalledWith(
			'server-a',
			7,
			expect.objectContaining({ tmdbId: '550', mediaType: 'movie' }),
			NOW
		);
	});

	it('hides cross-server items as not found before contacting TMDB', async () => {
		const { service, remote, repository } = fixture(null);
		await expect(
			service.confirm('server-b', 7, { tmdbId: '550', mediaType: 'movie' })
		).rejects.toMatchObject({ code: 'media_item_not_found' });
		expect(remote.verify).not.toHaveBeenCalled();
		expectNoMutation(repository);
	});

	it('clears the pin first, then re-resolves using independent stored GUIDs', async () => {
		const { service, repository, remote } = fixture(item({ manualMatchPinned: true }));
		const result = await service.clear('server-a', 7);
		expect(repository.clear).toHaveBeenCalledWith('server-a', 7, NOW);
		expect(remote.resolve).toHaveBeenCalledWith({ imdb: 'tt0000100' });
		expect(repository.applyAutomaticResolution).toHaveBeenCalledWith(
			'server-a',
			7,
			expect.objectContaining({
				reason: 'imdb_id',
				source: 'imdb_id',
				attemptedSources: ['imdb_id']
			})
		);
		expect(result.automaticResolution.status).toBe('resolved');
	});

	it('leaves a cleared item eligible without reviving stale candidates when no GUID remains', async () => {
		const { service, repository, remote } = fixture(
			item({ manualMatchPinned: true, imdbId: null, tvdbId: null })
		);
		const result = await service.clear('server-a', 7);
		expect(result.automaticResolution.status).toBe('eligible');
		expect(remote.resolve).not.toHaveBeenCalled();
		expect(repository.applyAutomaticResolution).not.toHaveBeenCalled();
		expect(repository.applyAutomaticUnresolved).not.toHaveBeenCalled();
	});

	it('still clears the pin when TMDB is unconfigured and reports deferred resolution', async () => {
		const { service, repository, remote } = fixture(item({ manualMatchPinned: true }));
		remote.resolve.mockRejectedValue(new ManualMatchError('tmdb_not_configured'));
		const result = await service.clear('server-a', 7);
		expect(repository.clear).toHaveBeenCalled();
		expect(result.automaticResolution).toEqual({
			status: 'failed',
			error: { code: 'tmdb_not_configured' }
		});
	});
});
