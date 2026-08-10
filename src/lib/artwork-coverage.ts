/**
 * Vocabulary for artwork coverage: what counts as evidence that a title's
 * artwork is in place, per occurrence, destination, and slot.
 *
 * Pure and `$env`-free so the reconciler, the query layer, and the UI all
 * classify from one definition. The states are deliberately not a boolean —
 * "applied" cannot express multiple servers, multiple destinations, artwork
 * changed behind our back, or evidence we simply do not have.
 */

/** The destinations artwork can reach. They never imply one another. */
export const COVERAGE_DESTINATIONS = ['server', 'kometa'] as const;
export type CoverageDestination = (typeof COVERAGE_DESTINATIONS)[number];

/**
 * What the evidence proves right now.
 *
 * - `applied_on_server` — a successful direct write whose expected fingerprint
 *   still matches what the server currently serves.
 * - `recorded_unverified` — we wrote it, but current server state could not be
 *   verified. History exists; proof does not.
 * - `externally_changed` — we wrote it and something else has since replaced it.
 * - `exported_to_kometa` — the current metadata file carries the slot's URL.
 *   This is a file on disk, not artwork on a server.
 * - `missing` — a *reliable* observation showed no entry or evidence.
 * - `unknown` — we could not observe reliably. Never conflate with `missing`.
 */
export const COVERAGE_STATUSES = [
	'applied_on_server',
	'recorded_unverified',
	'externally_changed',
	'exported_to_kometa',
	'missing',
	'unknown'
] as const;
export type CoverageStatus = (typeof COVERAGE_STATUSES)[number];

/** Statuses a `server` destination may hold. `exported_to_kometa` is absent by design. */
const SERVER_STATUSES = new Set<CoverageStatus>([
	'applied_on_server',
	'recorded_unverified',
	'externally_changed',
	'missing',
	'unknown'
]);

/** Statuses a `kometa` destination may hold. `applied_on_server` is absent by design. */
const KOMETA_STATUSES = new Set<CoverageStatus>(['exported_to_kometa', 'missing', 'unknown']);

/**
 * Whether a status may be recorded for a destination.
 *
 * The load-bearing exclusion: a Kometa export is a metadata file, and nothing
 * about writing that file proves Kometa ever ran or that a server accepted the
 * result. `exported_to_kometa` must never become `applied_on_server`, or the UI
 * would tell someone their artwork is live when only a YAML entry exists.
 */
export function isStatusValidForDestination(
	destination: CoverageDestination,
	status: CoverageStatus
): boolean {
	return destination === 'server' ? SERVER_STATUSES.has(status) : KOMETA_STATUSES.has(status);
}

/** True when the status is positive proof the artwork is in place at that destination. */
export function isCovered(status: CoverageStatus): boolean {
	return status === 'applied_on_server' || status === 'exported_to_kometa';
}

/**
 * True when the status means "we could not tell", as opposed to "we checked and
 * it is not there". A failed read must land here: reporting `missing` from an
 * unreadable file would mark a covered library as uncovered.
 */
export function isIndeterminate(status: CoverageStatus): boolean {
	return status === 'unknown' || status === 'recorded_unverified';
}

/** The authoritative media kind. Kept separate from any numeric identifier. */
export type CanonicalMediaKind = 'movie' | 'tv';

/**
 * Identity used to relate copies of one title across servers and libraries.
 *
 * The kind is part of the key, not decoration: TMDB numbers a movie and a show
 * independently, so movie 105 and show 105 are different titles and must never
 * share coverage. Returns `null` for an unresolved item — such an occurrence
 * keeps only its own evidence, and is never related to another by title or year.
 */
export function canonicalIdentityKey(
	kind: CanonicalMediaKind | null | undefined,
	tmdbId: string | number | null | undefined
): string | null {
	if (kind !== 'movie' && kind !== 'tv') return null;
	if (tmdbId === null || tmdbId === undefined) return null;
	const id = String(tmdbId).trim();
	return /^\d+$/.test(id) ? `${kind}:${id}` : null;
}
