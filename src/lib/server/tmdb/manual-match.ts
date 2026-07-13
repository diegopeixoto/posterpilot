import type { PlexGuids, TmdbMediaType, TmdbResolution } from '$lib/server/types';
import type { TmdbManualCandidate, TmdbManualSearchType } from '$lib/server/tmdb/manual-search';

export type ManualMatchErrorCode =
	| 'invalid_request'
	| 'media_item_not_found'
	| 'tmdb_not_configured'
	| 'tmdb_candidate_unavailable'
	| 'tmdb_unavailable'
	| 'manual_pin_not_found';

/** Locale-neutral domain failure rendered by route adapters. */
export class ManualMatchError extends Error {
	constructor(public readonly code: ManualMatchErrorCode) {
		super(code);
		this.name = 'ManualMatchError';
	}
}

export interface ManualMatchItem {
	id: number;
	serverInstanceId: string;
	title: string;
	year: number | null;
	tmdbId: string | null;
	imdbId: string | null;
	tvdbId: string | null;
	mediaType: TmdbMediaType | null;
	resolved: boolean;
	resolutionReason: string | null;
	manualMatchPinned: boolean;
	resolutionUpdatedAt: Date | null;
}

export interface ResolutionSummary {
	id: number;
	serverInstanceId: string;
	tmdbId: string | null;
	mediaType: TmdbMediaType | null;
	resolved: boolean;
	resolutionReason: string | null;
	manualMatchPinned: boolean;
	resolutionUpdatedAt: Date | null;
}

export interface ResolutionAuditEntry {
	id: number;
	action: 'created' | 'refreshed' | 'pinned' | 'replaced' | 'cleared' | 'unresolved';
	previousTmdbId: string | null;
	previousMediaType: TmdbMediaType | null;
	resultingTmdbId: string | null;
	resultingMediaType: TmdbMediaType | null;
	reason: string;
	source: string | null;
	userConfirmed: boolean;
	attemptedSources: string[] | null;
	createdAt: Date;
}

export interface AutomaticResolutionInput {
	resolution: TmdbResolution;
	reason: string;
	source: string;
	attemptedSources: string[];
	resolvedAt: Date;
}

export interface AutomaticUnresolvedInput {
	reason: string;
	source: string | null;
	attemptedSources: string[];
	resolvedAt: Date;
}

export interface ManualMatchRepository {
	getScopedItem(serverInstanceId: string, itemId: number): Promise<ManualMatchItem | null>;
	pin(
		serverInstanceId: string,
		itemId: number,
		candidate: TmdbManualCandidate,
		confirmedAt: Date
	): Promise<ResolutionSummary>;
	clear(serverInstanceId: string, itemId: number, clearedAt: Date): Promise<ResolutionSummary>;
	applyAutomaticResolution(
		serverInstanceId: string,
		itemId: number,
		input: AutomaticResolutionInput
	): Promise<ResolutionSummary>;
	applyAutomaticUnresolved(
		serverInstanceId: string,
		itemId: number,
		input: AutomaticUnresolvedInput
	): Promise<ResolutionSummary>;
	listAudits(serverInstanceId: string, itemId: number): Promise<ResolutionAuditEntry[]>;
}

export interface ManualMatchRemote {
	search(input: {
		query: string;
		year?: number;
		mediaType: TmdbManualSearchType;
		language?: string;
	}): Promise<TmdbManualCandidate[]>;
	verify(
		tmdbId: string,
		mediaType: TmdbMediaType,
		language?: string
	): Promise<TmdbManualCandidate | null>;
	resolve(guids: PlexGuids): Promise<TmdbResolution | null>;
}

export interface SearchManualMatchInput {
	query: string;
	year?: number;
	mediaType?: TmdbManualSearchType;
	language?: string;
}

export interface ConfirmManualMatchInput {
	tmdbId: string;
	mediaType: TmdbMediaType;
	language?: string;
}

export interface ManualMatchOptions {
	clock?: () => Date;
}

function validateScope(serverInstanceId: string, itemId: number): void {
	if (!serverInstanceId.trim() || !Number.isSafeInteger(itemId) || itemId <= 0) {
		throw new ManualMatchError('invalid_request');
	}
}

function normalizeSearch(input: SearchManualMatchInput) {
	if (typeof input.query !== 'string') throw new ManualMatchError('invalid_request');
	const query = input.query.normalize('NFKC').trim().replace(/\s+/gu, ' ');
	if (query.length === 0 || query.length > 200 || /[\p{Cc}\p{Cf}]/u.test(query)) {
		throw new ManualMatchError('invalid_request');
	}
	if (
		input.year !== undefined &&
		(!Number.isInteger(input.year) || input.year < 1800 || input.year > 9999)
	) {
		throw new ManualMatchError('invalid_request');
	}
	const mediaType = input.mediaType ?? 'both';
	if (mediaType !== 'movie' && mediaType !== 'tv' && mediaType !== 'both') {
		throw new ManualMatchError('invalid_request');
	}
	return { query, year: input.year, mediaType, language: input.language };
}

function validateCandidate(input: ConfirmManualMatchInput): ConfirmManualMatchInput {
	const tmdbId = typeof input.tmdbId === 'string' ? input.tmdbId.trim() : '';
	if (!/^\d+$/u.test(tmdbId) || tmdbId === '0') {
		throw new ManualMatchError('invalid_request');
	}
	if (input.mediaType !== 'movie' && input.mediaType !== 'tv') {
		throw new ManualMatchError('invalid_request');
	}
	return { ...input, tmdbId };
}

async function requireItem(
	repository: ManualMatchRepository,
	serverInstanceId: string,
	itemId: number
): Promise<ManualMatchItem> {
	validateScope(serverInstanceId, itemId);
	const item = await repository.getScopedItem(serverInstanceId, itemId);
	if (!item) throw new ManualMatchError('media_item_not_found');
	return item;
}

/** Manual-match workflow with remote identity verification separated from atomic writes. */
export function createManualMatchService(
	repository: ManualMatchRepository,
	remote: ManualMatchRemote,
	options: ManualMatchOptions = {}
) {
	const clock = options.clock ?? (() => new Date());

	async function search(
		serverInstanceId: string,
		itemId: number,
		input: SearchManualMatchInput
	): Promise<TmdbManualCandidate[]> {
		await requireItem(repository, serverInstanceId, itemId);
		const normalized = normalizeSearch(input);
		try {
			return await remote.search(normalized);
		} catch {
			throw new ManualMatchError('tmdb_unavailable');
		}
	}

	async function confirm(
		serverInstanceId: string,
		itemId: number,
		input: ConfirmManualMatchInput
	): Promise<ResolutionSummary> {
		await requireItem(repository, serverInstanceId, itemId);
		const candidateInput = validateCandidate(input);
		let candidate: TmdbManualCandidate | null;
		try {
			candidate = await remote.verify(
				candidateInput.tmdbId,
				candidateInput.mediaType,
				candidateInput.language
			);
		} catch {
			throw new ManualMatchError('tmdb_unavailable');
		}
		// Remote identity validation deliberately precedes the first mutation.
		if (!candidate) throw new ManualMatchError('tmdb_candidate_unavailable');
		return repository.pin(serverInstanceId, itemId, candidate, clock());
	}

	async function clear(serverInstanceId: string, itemId: number) {
		const current = await requireItem(repository, serverInstanceId, itemId);
		if (!current.manualMatchPinned) throw new ManualMatchError('manual_pin_not_found');
		const cleared = await repository.clear(serverInstanceId, itemId, clock());

		// A manual pin replaces the TMDB identity column, so only independent stored
		// GUIDs are safe for immediate automatic resolution. A later server sync can
		// also supply a fresh direct-TMDB GUID when imdb/tvdb are unavailable.
		const guids: PlexGuids = {
			...(current.imdbId ? { imdb: current.imdbId } : {}),
			...(current.tvdbId ? { tvdb: current.tvdbId } : {})
		};
		const source = current.imdbId ? 'imdb_id' : current.tvdbId ? 'tvdb_id' : null;
		if (!source) {
			return { item: cleared, automaticResolution: { status: 'eligible' as const } };
		}

		let resolution: TmdbResolution | null;
		try {
			resolution = await remote.resolve(guids);
		} catch (error) {
			const code =
				error instanceof ManualMatchError && error.code === 'tmdb_not_configured'
					? 'tmdb_not_configured'
					: 'tmdb_unavailable';
			return {
				item: cleared,
				automaticResolution: {
					status: 'failed' as const,
					error: { code }
				}
			};
		}

		if (!resolution) {
			const item = await repository.applyAutomaticUnresolved(serverInstanceId, itemId, {
				reason: 'no_match',
				source,
				attemptedSources: [source],
				resolvedAt: clock()
			});
			return { item, automaticResolution: { status: 'unresolved' as const } };
		}

		const item = await repository.applyAutomaticResolution(serverInstanceId, itemId, {
			resolution,
			reason: source,
			source,
			attemptedSources: [source],
			resolvedAt: clock()
		});
		return {
			item,
			automaticResolution: {
				status: item.manualMatchPinned ? ('skipped_pinned' as const) : ('resolved' as const)
			}
		};
	}

	async function audit(serverInstanceId: string, itemId: number) {
		await requireItem(repository, serverInstanceId, itemId);
		return repository.listAudits(serverInstanceId, itemId);
	}

	return { search, confirm, clear, audit };
}

export type ManualMatchService = ReturnType<typeof createManualMatchService>;
