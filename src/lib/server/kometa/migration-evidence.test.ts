import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from '$lib/server/db/schema';
import type { ApplySlot } from '$lib/server/plans/apply-plan';
import { kometaSlotFingerprint } from '$lib/server/revisions/kometa-state';
import {
	LEGACY_FILENAME,
	legacyKometaDestinationKey,
	resolveKometaDestination,
	type KometaLegacyDestinationV1
} from './destination';
import { classifyLegacyEntries, parseLegacyMetadata } from './migration-classifier';
import { loadKometaMigrationEvidence } from './migration-evidence';

interface ItemInput {
	id: number;
	serverInstanceId?: string;
	type?: 'movie' | 'show';
	tmdbId?: string | null;
	tvdbId?: string | null;
	imdbId?: string | null;
	sourceRemovedAt?: number | null;
}

interface SnapshotInput {
	id: string;
	serverInstanceId?: string;
	mediaItemId?: number | null;
	mediaCollectionId?: string | null;
	destination?: 'server' | 'kometa';
	slot?: ApplySlot;
	state?: 'present' | 'absent' | 'unavailable';
	value?: unknown;
	metadata?: Record<string, unknown> | null;
}

interface RevisionInput {
	id: string;
	serverInstanceId?: string;
	mediaItemId?: number | null;
	mediaCollectionId?: string | null;
	afterSnapshotId?: string | null;
	destination?: 'server' | 'kometa';
	slot?: ApplySlot;
	provenance?: Record<string, unknown> | null;
	proposedFingerprint?: string | null;
	outcome?: 'pending' | 'success' | 'failed' | 'skipped';
	verification?: 'pending' | 'exact' | 'best_effort' | 'unavailable' | 'mismatch' | 'failed';
	action?: 'apply' | 'undo' | 'external_observation';
}

const ROOT_POSTER: ApplySlot = { kind: 'poster', season: null, episode: null };
const MOVIE_URL = 'https://assets.invalid/movie-poster.jpg';
const SHOW_URL = 'https://assets.invalid/show-card.jpg';

let client: Client;
let database: LibSQLDatabase<typeof schema>;

function legacyDestination(mappingId: string): KometaLegacyDestinationV1 {
	return {
		version: 1,
		filename: LEGACY_FILENAME,
		namespace: 'tmdb',
		mappingId,
		key: legacyKometaDestinationKey(mappingId)
	};
}

function encoded(value: unknown): string | null {
	return value === null || value === undefined ? null : JSON.stringify(value);
}

async function addItem(input: ItemInput): Promise<void> {
	await client.execute({
		sql: `INSERT INTO media_items
			(id, server_instance_id, type, tmdb_id, tvdb_id, imdb_id, source_removed_at)
			VALUES (?, ?, ?, ?, ?, ?, ?)`,
		args: [
			input.id,
			input.serverInstanceId ?? 'server-a',
			input.type ?? 'movie',
			input.tmdbId ?? null,
			input.tvdbId ?? null,
			input.imdbId ?? null,
			input.sourceRemovedAt ?? null
		]
	});
}

async function addSnapshot(input: SnapshotInput): Promise<void> {
	const slot = input.slot ?? ROOT_POSTER;
	await client.execute({
		sql: `INSERT INTO artwork_snapshots
			(id, server_instance_id, media_item_id, media_collection_id, destination,
			 kind, season, episode, state, value, metadata)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			input.id,
			input.serverInstanceId ?? 'server-a',
			input.mediaItemId ?? 1,
			input.mediaCollectionId ?? null,
			input.destination ?? 'kometa',
			slot.kind,
			slot.season,
			slot.episode,
			input.state ?? 'present',
			encoded(input.value ?? { state: 'present', url: MOVIE_URL }),
			encoded(input.metadata)
		]
	});
}

async function addRevision(input: RevisionInput): Promise<void> {
	const slot = input.slot ?? ROOT_POSTER;
	await client.execute({
		sql: `INSERT INTO artwork_revisions
			(id, server_instance_id, media_item_id, media_collection_id, after_snapshot_id,
			 action, destination, kind, season, episode, provenance, proposed_fingerprint, outcome,
			 verification)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		args: [
			input.id,
			input.serverInstanceId ?? 'server-a',
			input.mediaItemId ?? 1,
			input.mediaCollectionId ?? null,
			input.afterSnapshotId ?? null,
			input.action ?? 'apply',
			input.destination ?? 'kometa',
			slot.kind,
			slot.season,
			slot.episode,
			encoded(input.provenance),
			input.proposedFingerprint ?? null,
			input.outcome ?? 'success',
			input.verification ?? 'exact'
		]
	});
}

beforeEach(async () => {
	client = createClient({ url: ':memory:' });
	database = drizzle(client, { schema });
	await client.executeMultiple(`
		CREATE TABLE media_items (
			id INTEGER PRIMARY KEY,
			server_instance_id TEXT NOT NULL,
			type TEXT NOT NULL,
			tmdb_id TEXT,
			tvdb_id TEXT,
			imdb_id TEXT,
			source_removed_at INTEGER
		);
		CREATE TABLE artwork_snapshots (
			id TEXT PRIMARY KEY,
			server_instance_id TEXT NOT NULL,
			media_item_id INTEGER,
			media_collection_id TEXT,
			destination TEXT NOT NULL,
			kind TEXT NOT NULL,
			season INTEGER,
			episode INTEGER,
			state TEXT NOT NULL,
			value TEXT,
			metadata TEXT
		);
		CREATE TABLE artwork_revisions (
			id TEXT PRIMARY KEY,
			server_instance_id TEXT NOT NULL,
			media_item_id INTEGER,
			media_collection_id TEXT,
			after_snapshot_id TEXT,
			action TEXT NOT NULL,
			destination TEXT NOT NULL,
			kind TEXT NOT NULL,
			season INTEGER,
			episode INTEGER,
			provenance TEXT,
			proposed_fingerprint TEXT,
			outcome TEXT NOT NULL,
			verification TEXT NOT NULL
		);
	`);
});

afterEach(() => client.close());

describe('Kometa migration evidence repository', () => {
	it('returns deterministic active mappings and exact legacy evidence for movies and shows', async () => {
		const titleCard: ApplySlot = { kind: 'title_card', season: 1, episode: 2 };
		await addItem({ id: 2, type: 'show', tmdbId: '202', tvdbId: '303', imdbId: 'tt1234567' });
		await addItem({ id: 1, type: 'movie', tmdbId: '101', imdbId: 'tt7654321' });
		await addItem({ id: 3, serverInstanceId: 'server-b', type: 'movie', tmdbId: '999' });
		await addSnapshot({
			id: 'snapshot-movie',
			mediaItemId: 1,
			value: { state: 'present', url: MOVIE_URL },
			metadata: { tmdbId: '101' }
		});
		await addSnapshot({
			id: 'snapshot-show',
			mediaItemId: 2,
			slot: titleCard,
			value: { state: 'present', url: SHOW_URL },
			metadata: null
		});
		await addRevision({
			id: 'revision-show',
			mediaItemId: 2,
			afterSnapshotId: 'snapshot-show',
			slot: titleCard,
			provenance: { legacyKometaDestination: legacyDestination('202') }
		});
		await addRevision({
			id: 'revision-movie',
			mediaItemId: 1,
			afterSnapshotId: 'snapshot-movie',
			proposedFingerprint: kometaSlotFingerprint({ state: 'present', url: MOVIE_URL })
		});

		const evidence = await loadKometaMigrationEvidence(database, 'server-a');

		expect(evidence.mappings).toEqual([
			{
				mediaItemId: 1,
				type: 'movie',
				tmdbId: '101',
				tvdbId: null,
				imdbId: 'tt7654321'
			},
			{
				mediaItemId: 2,
				type: 'show',
				tmdbId: '202',
				tvdbId: '303',
				imdbId: 'tt1234567'
			}
		]);
		expect(evidence.revisionMappings).toEqual([
			{
				mediaItemId: 1,
				type: 'movie',
				tmdbId: '101',
				tvdbId: null,
				imdbId: 'tt7654321'
			},
			{
				mediaItemId: 2,
				type: 'show',
				tmdbId: '202',
				tvdbId: '303',
				imdbId: 'tt1234567'
			}
		]);
		expect(evidence.revisions).toEqual([
			{
				revisionId: 'revision-movie',
				mediaItemId: 1,
				legacyMappingId: '101',
				slot: ROOT_POSTER,
				proposedFingerprint: kometaSlotFingerprint({ state: 'present', url: MOVIE_URL })
			},
			{
				revisionId: 'revision-show',
				mediaItemId: 2,
				legacyMappingId: '202',
				slot: titleCard,
				proposedFingerprint: kometaSlotFingerprint({ state: 'present', url: SHOW_URL })
			}
		]);
		expect(JSON.stringify(evidence)).not.toContain(MOVIE_URL);
		expect(JSON.stringify(evidence)).not.toContain(SHOW_URL);
	});

	it('rejects revision, snapshot, and item scope disagreements', async () => {
		await addItem({ id: 1, type: 'movie', tmdbId: '101' });
		await addItem({ id: 2, serverInstanceId: 'server-b', type: 'movie', tmdbId: '202' });
		const proof = { legacyKometaDestination: legacyDestination('101') };

		await addSnapshot({ id: 'snapshot-other-server', serverInstanceId: 'server-b' });
		await addRevision({
			id: 'revision-other-snapshot-server',
			afterSnapshotId: 'snapshot-other-server',
			provenance: proof
		});

		await addSnapshot({ id: 'snapshot-other-item', mediaItemId: 2 });
		await addRevision({
			id: 'revision-other-snapshot-item',
			afterSnapshotId: 'snapshot-other-item',
			provenance: proof
		});

		await addSnapshot({ id: 'snapshot-other-item-scope', mediaItemId: 2 });
		await addRevision({
			id: 'revision-other-item-scope',
			mediaItemId: 2,
			afterSnapshotId: 'snapshot-other-item-scope',
			provenance: proof
		});

		await addSnapshot({
			id: 'snapshot-collection-scope',
			mediaCollectionId: 'collection-a'
		});
		await addRevision({
			id: 'revision-collection-scope',
			mediaCollectionId: 'collection-a',
			afterSnapshotId: 'snapshot-collection-scope',
			provenance: proof
		});

		expect((await loadKometaMigrationEvidence(database, 'server-a')).revisions).toEqual([]);
	});

	it('accepts only successful, exact Kometa revisions joined to an after snapshot', async () => {
		await addItem({ id: 1, type: 'movie', tmdbId: '101' });
		await addSnapshot({
			id: 'snapshot',
			metadata: { legacyKometaDestination: legacyDestination('101') }
		});
		const base = {
			afterSnapshotId: 'snapshot',
			provenance: { legacyKometaDestination: legacyDestination('101') }
		};
		await addRevision({ id: 'revision-no-snapshot', ...base, afterSnapshotId: null });
		await addRevision({ id: 'revision-missing-snapshot', ...base, afterSnapshotId: 'missing' });
		await addRevision({ id: 'revision-failed', ...base, outcome: 'failed' });
		await addRevision({ id: 'revision-not-exact', ...base, verification: 'mismatch' });
		await addRevision({ id: 'revision-server', ...base, destination: 'server' });
		await addRevision({ id: 'revision-undo', ...base, action: 'undo' });
		await addRevision({
			id: 'revision-external-observation',
			...base,
			action: 'external_observation'
		});

		expect((await loadKometaMigrationEvidence(database, 'server-a')).revisions).toEqual([]);
	});

	it('rejects unproven, conflicting, and typed destinations', async () => {
		await addItem({ id: 1, type: 'movie', tmdbId: '101' });
		const typed = resolveKometaDestination({ type: 'movie', tmdbId: '101' });
		if (!typed.ok) throw new Error('typed test destination must resolve');

		await addSnapshot({ id: 'snapshot-unproven' });
		await addRevision({ id: 'revision-unproven', afterSnapshotId: 'snapshot-unproven' });

		await addSnapshot({
			id: 'snapshot-typed',
			metadata: { kometaDestination: typed.destination }
		});
		await addRevision({
			id: 'revision-typed',
			afterSnapshotId: 'snapshot-typed',
			provenance: { kometaDestination: typed.destination }
		});

		await addSnapshot({
			id: 'snapshot-conflicting',
			metadata: { legacyKometaDestination: legacyDestination('102') }
		});
		await addRevision({
			id: 'revision-conflicting',
			afterSnapshotId: 'snapshot-conflicting',
			provenance: { legacyKometaDestination: legacyDestination('101') }
		});

		expect((await loadKometaMigrationEvidence(database, 'server-a')).revisions).toEqual([]);
	});

	it('rejects a fingerprint that disagrees with the exact observed snapshot', async () => {
		await addItem({ id: 1, type: 'movie', tmdbId: '101' });
		await addSnapshot({
			id: 'snapshot',
			metadata: { legacyKometaDestination: legacyDestination('101') }
		});
		await addRevision({
			id: 'revision',
			afterSnapshotId: 'snapshot',
			proposedFingerprint: kometaSlotFingerprint({
				state: 'present',
				url: 'https://assets.invalid/different.jpg'
			})
		});

		expect((await loadKometaMigrationEvidence(database, 'server-a')).revisions).toEqual([]);
	});

	it('keeps exact apply provenance for a removed item without making it a direct mapping', async () => {
		await addItem({
			id: 1,
			type: 'show',
			tmdbId: '42',
			tvdbId: '900',
			sourceRemovedAt: Date.parse('2026-08-01T00:00:00Z')
		});
		await addItem({ id: 2, type: 'movie', tmdbId: '42' });
		const raw = `metadata:\n  42: { url_poster: ${SHOW_URL} }\n`;
		await addSnapshot({
			id: 'snapshot',
			mediaItemId: 1,
			value: { state: 'present', url: SHOW_URL },
			metadata: { legacyKometaDestination: legacyDestination('42') }
		});
		await addRevision({
			id: 'revision',
			mediaItemId: 1,
			afterSnapshotId: 'snapshot',
			provenance: { legacyKometaDestination: legacyDestination('42') }
		});

		const evidence = await loadKometaMigrationEvidence(database, 'server-a');
		expect(evidence.mappings).toEqual([
			{
				mediaItemId: 2,
				type: 'movie',
				tmdbId: '42',
				tvdbId: null,
				imdbId: null
			}
		]);
		expect(evidence.revisionMappings).toEqual([
			{
				mediaItemId: 1,
				type: 'show',
				tmdbId: '42',
				tvdbId: '900',
				imdbId: null
			}
		]);
		expect(
			classifyLegacyEntries({ parsed: parseLegacyMetadata(raw), ...evidence }).classified
		).toMatchObject([
			{
				evidence: 'revision',
				destination: { mediaKind: 'show', namespace: 'tvdb', mappingId: '900' }
			}
		]);
		expect(evidence.revisions).toMatchObject([
			{
				revisionId: 'revision',
				mediaItemId: 1,
				legacyMappingId: '42'
			}
		]);
	});
});
