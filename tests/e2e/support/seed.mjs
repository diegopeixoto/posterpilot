import { createClient } from '@libsql/client';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const appPort = Number(process.env.POSTERPILOT_E2E_PORT ?? 14170);
const runId = process.env.POSTERPILOT_E2E_RUN_ID;
if (!runId || !/^[a-zA-Z0-9_-]+$/.test(runId)) {
	throw new Error('The Playwright config must provide a safe POSTERPILOT_E2E_RUN_ID.');
}
const runtimeFile = fileURLToPath(new URL(`../.runtime-${appPort}-${runId}.json`, import.meta.url));
const scenarioFile = fileURLToPath(
	new URL(`../.scenario-${appPort}-${runId}.json`, import.meta.url)
);

function readJson(path, label) {
	if (!existsSync(path)) throw new Error(`${label} is unavailable; did the E2E harness start?`);
	return JSON.parse(readFileSync(path, 'utf8'));
}

export function readRuntime() {
	return readJson(runtimeFile, 'E2E runtime metadata');
}

export function readScenario() {
	return readJson(scenarioFile, 'E2E scenario metadata');
}

function writeScenario(value) {
	writeFileSync(scenarioFile, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

async function execute(client, sql, args = []) {
	return client.execute({ sql, args });
}

function firstRow(result, description) {
	const row = result.rows[0];
	if (!row) throw new Error(`E2E seed could not find ${description}`);
	return row;
}

/**
 * Enrich the records imported through the real first sync with deterministic local
 * artwork candidates and collection evidence. No production endpoint or test-only
 * application branch is involved; this is an external fixture over a throwaway DB.
 */
export async function seedPrimaryScenario() {
	const runtime = readRuntime();
	const client = createClient({ url: `file:${runtime.databaseFile}` });
	// Drizzle's SQLite `timestamp` columns persist Unix seconds (not milliseconds).
	const now = Math.floor(Date.now() / 1000);
	try {
		const server = firstRow(
			await execute(
				client,
				`select id, name from server_instances
				 where disconnected_at is null
				 order by protected desc, created_at asc limit 1`
			),
			'the primary server'
		);
		const serverId = String(server.id);
		const imported = await execute(
			client,
			`select id, rating_key, title, type from media_items
			 where server_instance_id = ? order by id`,
			[serverId]
		);
		const byRatingKey = new Map(imported.rows.map((row) => [String(row.rating_key), row]));
		const definitions = [
			{
				ratingKey: 'jf-alpha',
				tmdbId: '71001',
				overview: 'A quiet expedition crosses a violet horizon.',
				runtime: 105,
				rating: 8.4,
				genres: ['Adventure', 'Drama']
			},
			{
				ratingKey: 'jf-bravo',
				tmdbId: '71002',
				overview: 'A nocturnal mystery unfolds inside an old cinema.',
				runtime: 112,
				rating: 7.8,
				genres: ['Mystery', 'Drama']
			},
			{
				ratingKey: 'jf-echo',
				tmdbId: '71003',
				overview: 'Three archivists restore a film everyone forgot.',
				runtime: 98,
				rating: 8.1,
				genres: ['Drama', 'History']
			},
			{
				ratingKey: 'jf-delta',
				tmdbId: '72001',
				overview: 'A serialized journey through a city of memories.',
				runtime: 52,
				rating: 8.7,
				genres: ['Drama', 'Science Fiction']
			}
		];

		for (const definition of definitions) {
			const row = byRatingKey.get(definition.ratingKey);
			if (!row) throw new Error(`E2E seed missing imported item ${definition.ratingKey}`);
			await execute(
				client,
				`update media_items set
				 tmdb_id = ?, media_type = ?, resolution_reason = ?, manual_match_pinned = ?, resolved = 1,
				 overview = ?, tagline = ?, genres = ?, runtime = ?, rating = ?,
				 backdrop_url = current_background_url, season_count = ?, episode_count = ?,
				 tmdb_collection_id = '70001', tmdb_collection_name = 'E2E Saga',
				 has_candidates = 1, has_mediux = 1, discovery_status = 'succeeded',
				 discovery_completed_at = ?, last_synced_at = ?, updated_at = ?
				 where id = ? and server_instance_id = ?`,
				[
					definition.tmdbId,
					String(row.type) === 'show' ? 'tv' : 'movie',
					definition.ratingKey === 'jf-delta' ? 'manual' : 'e2e_fixture',
					definition.ratingKey === 'jf-delta' ? 1 : 0,
					definition.overview,
					`E2E fixture for ${String(row.title)}`,
					JSON.stringify(definition.genres),
					definition.runtime,
					definition.rating,
					String(row.type) === 'show' ? 1 : null,
					String(row.type) === 'show' ? 1 : null,
					now,
					now,
					now,
					Number(row.id),
					serverId
				]
			);
		}

		await execute(client, 'delete from poster_candidates where server_instance_id = ?', [serverId]);
		const candidateRows = [];
		for (const definition of definitions.slice(0, 3)) {
			const item = byRatingKey.get(definition.ratingKey);
			for (const kind of ['poster', 'background']) {
				candidateRows.push({
					itemId: Number(item.id),
					tmdbId: definition.tmdbId,
					kind,
					assetId: `${definition.ratingKey}-${kind}-primary`,
					url: `${runtime.fakeJellyfinUrl}/assets/${definition.ratingKey}-${kind}-primary.png`,
					score: kind === 'poster' ? 9.5 : 8.9
				});
			}
		}
		candidateRows.push({
			itemId: Number(byRatingKey.get('jf-alpha').id),
			tmdbId: '71001',
			kind: 'poster',
			assetId: 'jf-alpha-poster-alternate',
			url: `${runtime.fakeJellyfinUrl}/assets/jf-alpha-poster-alternate.png`,
			score: 8.7
		});

		for (const candidate of candidateRows) {
			await execute(
				client,
				`insert into poster_candidates (
				 server_instance_id, media_item_id, discovery_run_id, set_id, provider,
				 provider_asset_id, set_author, design_family, language, url, kind,
				 resolved_tmdb_id, resolved_media_type, width, height, score,
				 active, stale, last_seen_at, created_at
				) values (?, ?, null, 'e2e-violet-family', 'mediux', ?, 'E2E Curator',
				 'violet-noir', 'en', ?, ?, ?, 'movie', ?, ?, ?, 1, 0, ?, ?)`,
				[
					serverId,
					candidate.itemId,
					candidate.assetId,
					candidate.url,
					candidate.kind,
					candidate.tmdbId,
					candidate.kind === 'poster' ? 1000 : 1600,
					candidate.kind === 'poster' ? 1500 : 900,
					candidate.score,
					now,
					now
				]
			);
		}

		await execute(
			client,
			`insert into media_collections (
			 id, server_instance_id, source, source_id, name, metadata,
			 first_seen_at, last_synced_at, updated_at
			) values ('e2e-collection-a', ?, 'tmdb', '70001', 'E2E Saga', ?, ?, ?, ?)
			 on conflict(id) do update set
			 name = excluded.name, metadata = excluded.metadata,
			 last_synced_at = excluded.last_synced_at, removed_at = null,
			 updated_at = excluded.updated_at`,
			[serverId, JSON.stringify({ source: 'e2e' }), now, now, now]
		);
		await execute(
			client,
			"delete from collection_memberships where collection_id = 'e2e-collection-a'"
		);
		for (const definition of definitions.slice(0, 3)) {
			const item = byRatingKey.get(definition.ratingKey);
			await execute(
				client,
				`insert into collection_memberships (
				 server_instance_id, collection_id, media_item_id, source, source_member_id,
				 title, year, available_locally, provenance, first_seen_at, last_seen_at
				) values (?, 'e2e-collection-a', ?, 'tmdb', ?, ?, ?, 1, ?, ?, ?)`,
				[
					serverId,
					Number(item.id),
					definition.tmdbId,
					String(item.title),
					Number(item.title === 'Alpha Dawn' ? 2020 : item.title === 'Bravo Night' ? 2021 : 2022),
					JSON.stringify({ exactTmdbId: definition.tmdbId }),
					now,
					now
				]
			);
		}
		await execute(
			client,
			`insert into collection_memberships (
			 server_instance_id, collection_id, media_item_id, source, source_member_id,
			 title, year, available_locally, provenance, first_seen_at, last_seen_at
			) values (?, 'e2e-collection-a', null, 'tmdb', '71999',
			 'Unavailable Chapter', 2025, 0, ?, ?, ?)`,
			[serverId, JSON.stringify({ exactTmdbId: '71999' }), now, now]
		);

		await execute(
			client,
			`insert into settings(key, value) values ('funEnabled', 'true')
			 on conflict(key) do update set value = excluded.value`
		);
		await execute(
			client,
			`insert into settings(key, value) values ('setupDismissed', 'true')
			 on conflict(key) do update set value = excluded.value`
		);

		const scenario = {
			primaryServerId: serverId,
			primaryServerName: String(server.name),
			primaryCollectionId: 'e2e-collection-a',
			primaryItems: Object.fromEntries(
				definitions.map((definition) => [
					definition.ratingKey.replace('jf-', ''),
					Number(byRatingKey.get(definition.ratingKey).id)
				])
			)
		};
		writeScenario(scenario);
		return scenario;
	} finally {
		client.close();
	}
}

export function recordSecondaryServer(serverId, name) {
	const scenario = readScenario();
	writeScenario({ ...scenario, secondaryServerId: serverId, secondaryServerName: name });
}
