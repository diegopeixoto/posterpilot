import { rankFunItems } from './fun-seed';

export interface PosterMatchCandidate {
	id: number;
	url: string;
}

export interface PosterMatchState {
	version: 1;
	seed: string;
	round: number;
	remaining: number[];
	nextRound: number[];
	matchIndex: number;
	current: [number, number] | null;
	winnerId: number | null;
	unavailableIds: number[];
	totalMatches: number;
	completedMatches: number;
}

function uniqueCandidates(candidates: readonly PosterMatchCandidate[]): PosterMatchCandidate[] {
	const seenIds = new Set<number>();
	const seenUrls = new Set<string>();
	return candidates.filter((candidate) => {
		if (seenIds.has(candidate.id) || seenUrls.has(candidate.url)) return false;
		seenIds.add(candidate.id);
		seenUrls.add(candidate.url);
		return true;
	});
}

function beginRound(state: PosterMatchState): PosterMatchState {
	let remaining = state.remaining;
	let nextRound = state.nextRound;
	let round = state.round;
	let matchIndex = state.matchIndex;

	while (remaining.length > 1 && matchIndex >= remaining.length) {
		remaining = nextRound;
		nextRound = [];
		round += 1;
		matchIndex = 0;
	}
	if (remaining.length === 1 && nextRound.length === 0) {
		return {
			...state,
			remaining,
			nextRound,
			round,
			matchIndex,
			current: null,
			winnerId: remaining[0]
		};
	}
	if (matchIndex + 1 >= remaining.length) {
		nextRound = [...nextRound, remaining[matchIndex]];
		return beginRound({ ...state, remaining, nextRound, round, matchIndex: matchIndex + 1 });
	}
	return {
		...state,
		remaining,
		nextRound,
		round,
		matchIndex,
		current: [remaining[matchIndex], remaining[matchIndex + 1]],
		winnerId: null
	};
}

export function createPosterMatch(
	candidates: readonly PosterMatchCandidate[],
	seed: string
): PosterMatchState {
	const ranked = rankFunItems(uniqueCandidates(candidates), seed);
	const initial: PosterMatchState = {
		version: 1,
		seed,
		round: 1,
		remaining: ranked.map((candidate) => candidate.id),
		nextRound: [],
		matchIndex: 0,
		current: null,
		winnerId: ranked.length === 1 ? ranked[0].id : null,
		unavailableIds: [],
		totalMatches: Math.max(0, ranked.length - 1),
		completedMatches: 0
	};
	return ranked.length > 1 ? beginRound(initial) : initial;
}

export function choosePosterMatchWinner(
	state: PosterMatchState,
	winnerId: number
): PosterMatchState {
	if (!state.current || !state.current.includes(winnerId)) return state;
	return beginRound({
		...state,
		nextRound: [...state.nextRound, winnerId],
		matchIndex: state.matchIndex + 2,
		current: null,
		completedMatches: state.completedMatches + 1
	});
}

export function markPosterMatchUnavailable(
	state: PosterMatchState,
	candidateId: number
): PosterMatchState {
	if (state.unavailableIds.includes(candidateId)) return state;
	const unavailableIds = [...state.unavailableIds, candidateId];
	if (state.winnerId === candidateId) return { ...state, unavailableIds, winnerId: null };
	if (!state.current?.includes(candidateId)) return { ...state, unavailableIds };
	const opponent = state.current.find((id) => id !== candidateId)!;
	if (!unavailableIds.includes(opponent)) {
		return choosePosterMatchWinner({ ...state, unavailableIds }, opponent);
	}
	return beginRound({
		...state,
		unavailableIds,
		matchIndex: state.matchIndex + 2,
		current: null,
		completedMatches: state.completedMatches + 1
	});
}
