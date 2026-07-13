import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
	const typeBytes = Buffer.from(type, 'ascii');
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const checksum = Buffer.alloc(4);
	checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
	return Buffer.concat([length, typeBytes, data, checksum]);
}

/** Tiny valid RGB PNGs keep the fake deterministic without checked-in binary fixtures. */
function png(red, green, blue) {
	const header = Buffer.alloc(13);
	header.writeUInt32BE(2, 0);
	header.writeUInt32BE(3, 4);
	header[8] = 8;
	header[9] = 2;
	const scanlines = Buffer.from([
		0,
		red,
		green,
		blue,
		red,
		green,
		blue,
		0,
		red,
		green,
		blue,
		red,
		green,
		blue,
		0,
		red,
		green,
		blue,
		red,
		green,
		blue
	]);
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		pngChunk('IHDR', header),
		pngChunk('IDAT', deflateSync(scanlines)),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

function colorFromText(value) {
	let hash = 2166136261;
	for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
	return png((hash >>> 16) & 255, (hash >>> 8) & 255, hash & 255);
}

function sendJson(response, value, status = 200) {
	response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
	response.end(JSON.stringify(value));
}

function sendImage(response, bytes, status = 200) {
	response.writeHead(status, {
		'content-type': 'image/png',
		'cache-control': 'no-store',
		'content-length': String(bytes.length)
	});
	response.end(bytes);
}

function notFound(response) {
	sendJson(response, { error: 'not found' }, 404);
}

async function bodyBuffer(request) {
	const chunks = [];
	for await (const chunk of request) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

function jellyfinFixture() {
	const items = [
		{
			Id: 'jf-alpha',
			Name: 'Alpha Dawn',
			ProductionYear: 2020,
			Type: 'Movie',
			DateLastModified: '2026-07-01T10:00:00.000Z',
			DateCreated: '2026-06-01T10:00:00.000Z',
			UserData: { Played: false }
		},
		{
			Id: 'jf-bravo',
			Name: 'Bravo Night',
			ProductionYear: 2021,
			Type: 'Movie',
			DateLastModified: '2026-07-01T10:01:00.000Z',
			DateCreated: '2026-06-02T10:00:00.000Z',
			UserData: { Played: false }
		},
		{
			Id: 'jf-echo',
			Name: 'Cinema Echo',
			ProductionYear: 2022,
			Type: 'Movie',
			DateLastModified: '2026-07-01T10:02:00.000Z',
			DateCreated: '2026-06-03T10:00:00.000Z',
			UserData: { Played: true }
		},
		{
			Id: 'jf-delta',
			Name: 'Delta Series',
			ProductionYear: 2023,
			Type: 'Series',
			DateLastModified: '2026-07-01T10:03:00.000Z',
			DateCreated: '2026-06-04T10:00:00.000Z',
			UserData: { Played: false }
		}
	];
	const artwork = new Map();
	let revision = 0;
	for (const item of items) {
		artwork.set(item.Id, {
			poster: { tag: `original-${item.Id}-poster`, bytes: colorFromText(`${item.Id}:poster`) },
			background: {
				tag: `original-${item.Id}-background`,
				bytes: colorFromText(`${item.Id}:background`)
			}
		});
	}
	artwork.set('jf-collection', {
		poster: { tag: 'original-collection-poster', bytes: colorFromText('collection:poster') },
		background: {
			tag: 'original-collection-background',
			bytes: colorFromText('collection:background')
		}
	});

	function enriched(item) {
		const current = artwork.get(item.Id);
		return {
			...item,
			...(current?.poster ? { ImageTags: { Primary: current.poster.tag } } : {}),
			...(current?.background ? { BackdropImageTags: [current.background.tag] } : {})
		};
	}

	return { items, artwork, enriched, nextRevision: () => ++revision };
}

function plexFixture() {
	const items = [
		{ ratingKey: 'plex-aurora', title: 'Aurora Archive', year: 2019, type: 'movie' },
		{ ratingKey: 'plex-borealis', title: 'Borealis Cut', year: 2024, type: 'movie' }
	];
	const artwork = new Map();
	let revision = 0;
	for (const item of items) {
		artwork.set(item.ratingKey, {
			poster: {
				tag: `original-${item.ratingKey}-poster`,
				bytes: colorFromText(`${item.ratingKey}:poster`)
			},
			background: {
				tag: `original-${item.ratingKey}-background`,
				bytes: colorFromText(`${item.ratingKey}:background`)
			}
		});
	}
	artwork.set('plex-collection', {
		poster: {
			tag: 'original-plex-collection-poster',
			bytes: colorFromText('plex-collection:poster')
		},
		background: {
			tag: 'original-plex-collection-background',
			bytes: colorFromText('plex-collection:background')
		}
	});
	return { items, artwork, nextRevision: () => ++revision };
}

function createJellyfinServer() {
	const fixture = jellyfinFixture();
	return createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		const path = url.pathname;

		if (request.method === 'POST' && path === '/Users/AuthenticateByName') {
			const payload = JSON.parse((await bodyBuffer(request)).toString('utf8') || '{}');
			if (payload.Username !== 'e2e' || payload.Pw !== 'posterpilot') {
				sendJson(response, { error: 'unauthorized' }, 401);
				return;
			}
			sendJson(response, {
				AccessToken: 'jellyfin-e2e-token',
				User: { Id: 'e2e-user', Name: 'E2E User' }
			});
			return;
		}

		if (request.method === 'GET' && path === '/System/Info') {
			sendJson(response, { ServerName: 'Living Room A', Version: '10.10.0-e2e' });
			return;
		}

		if (request.method === 'GET' && path === '/Library/MediaFolders') {
			sendJson(response, {
				Items: [
					{ Id: 'lib-movies-a', Name: 'Movies A', CollectionType: 'movies' },
					{ Id: 'lib-shows-a', Name: 'Shows A', CollectionType: 'tvshows' },
					{ Id: 'lib-music-a', Name: 'Music', CollectionType: 'music' }
				]
			});
			return;
		}

		if (request.method === 'GET' && path === '/Items') {
			const parent = url.searchParams.get('ParentId');
			const types = url.searchParams.get('IncludeItemTypes') ?? '';
			if (types.includes('BoxSet')) {
				sendJson(response, {
					Items: [
						{
							Id: 'jf-collection',
							Name: 'Native E2E Collection',
							Type: 'BoxSet',
							...fixture.enriched({ Id: 'jf-collection' })
						}
					]
				});
				return;
			}
			if (parent === 'jf-collection') {
				sendJson(response, { Items: fixture.items.slice(0, 3).map(fixture.enriched) });
				return;
			}
			if (parent === 'lib-movies-a') {
				sendJson(response, { Items: fixture.items.slice(0, 3).map(fixture.enriched) });
				return;
			}
			if (parent === 'lib-shows-a') {
				sendJson(response, { Items: fixture.items.slice(3).map(fixture.enriched) });
				return;
			}
			if (parent === 'jf-delta' && types.includes('Season')) {
				sendJson(response, {
					Items: [{ Id: 'jf-delta-s1', Name: 'Season 1', Type: 'Season', IndexNumber: 1 }]
				});
				return;
			}
			if (parent === 'jf-delta-s1' && types.includes('Episode')) {
				sendJson(response, {
					Items: [{ Id: 'jf-delta-s1e1', Name: 'Pilot', Type: 'Episode', IndexNumber: 1 }]
				});
				return;
			}
			sendJson(response, { Items: [] });
			return;
		}

		const imageMatch = path.match(/^\/Items\/([^/]+)\/Images\/(Primary|Backdrop)(?:\/\d+)?$/);
		if (imageMatch) {
			const [, rawId, rawType] = imageMatch;
			const id = decodeURIComponent(rawId);
			const kind = rawType === 'Primary' ? 'poster' : 'background';
			const current = fixture.artwork.get(id);
			if (request.method === 'GET') {
				if (!current?.[kind]) notFound(response);
				else sendImage(response, current[kind].bytes);
				return;
			}
			if (request.method === 'POST') {
				const encoded = (await bodyBuffer(request)).toString('utf8');
				const bytes = Buffer.from(encoded, 'base64');
				const slots = current ?? {};
				slots[kind] = {
					tag: `upload-${fixture.nextRevision()}-${kind}`,
					bytes: bytes.length ? bytes : colorFromText(`fallback:${id}:${kind}`)
				};
				fixture.artwork.set(id, slots);
				response.writeHead(204);
				response.end();
				return;
			}
			if (request.method === 'DELETE') {
				if (current) delete current[kind];
				response.writeHead(204);
				response.end();
				return;
			}
		}

		const itemMatch = path.match(/^\/Items\/([^/]+)$/);
		if (request.method === 'GET' && itemMatch) {
			const id = decodeURIComponent(itemMatch[1]);
			const item = fixture.items.find((candidate) => candidate.Id === id) ?? { Id: id };
			if (!fixture.artwork.has(id) && !fixture.items.some((candidate) => candidate.Id === id)) {
				notFound(response);
				return;
			}
			sendJson(response, fixture.enriched(item));
			return;
		}

		if (request.method === 'GET' && path.startsWith('/assets/')) {
			sendImage(response, colorFromText(path));
			return;
		}

		notFound(response);
	});
}

function createPlexServer() {
	const fixture = plexFixture();
	function metadata(item) {
		const current = fixture.artwork.get(item.ratingKey);
		return {
			...item,
			thumb: current?.poster
				? `/images/${encodeURIComponent(item.ratingKey)}/poster/${current.poster.tag}`
				: undefined,
			art: current?.background
				? `/images/${encodeURIComponent(item.ratingKey)}/background/${current.background.tag}`
				: undefined,
			updatedAt: 1782900000,
			addedAt: 1780308000,
			Guid: []
		};
	}
	return createServer(async (request, response) => {
		const url = new URL(request.url ?? '/', 'http://127.0.0.1');
		const path = url.pathname;
		const token = request.headers['x-plex-token'] ?? url.searchParams.get('X-Plex-Token');
		if (token === 'bad-token') {
			sendJson(response, { error: 'unauthorized' }, 401);
			return;
		}

		if (request.method === 'GET' && path === '/identity') {
			sendJson(response, {
				MediaContainer: {
					machineIdentifier: 'plex-e2e-b',
					friendlyName: 'Cinema B',
					version: '1.41.0-e2e'
				}
			});
			return;
		}
		if (request.method === 'GET' && path === '/') {
			sendJson(response, { MediaContainer: { friendlyName: 'Cinema B', version: '1.41.0-e2e' } });
			return;
		}
		if (request.method === 'GET' && path === '/library/sections') {
			sendJson(response, {
				MediaContainer: {
					Directory: [{ key: 'plex-movies-b', title: 'Movies B', type: 'movie' }]
				}
			});
			return;
		}
		if (request.method === 'GET' && path === '/library/sections/plex-movies-b/all') {
			sendJson(response, { MediaContainer: { Metadata: fixture.items.map(metadata) } });
			return;
		}
		if (request.method === 'GET' && path === '/library/sections/plex-movies-b/collections') {
			sendJson(response, {
				MediaContainer: {
					Metadata: [
						metadata({
							ratingKey: 'plex-collection',
							title: 'Plex E2E Collection',
							type: 'collection'
						})
					]
				}
			});
			return;
		}
		if (request.method === 'GET' && path === '/library/metadata/plex-collection/children') {
			sendJson(response, { MediaContainer: { Metadata: fixture.items.map(metadata) } });
			return;
		}

		const imageMatch = path.match(/^\/images\/([^/]+)\/(poster|background)\/[^/]+$/);
		if (request.method === 'GET' && imageMatch) {
			const [, rawId, kind] = imageMatch;
			const current = fixture.artwork.get(decodeURIComponent(rawId));
			if (!current?.[kind]) notFound(response);
			else sendImage(response, current[kind].bytes);
			return;
		}

		const childrenMatch = path.match(/^\/library\/metadata\/([^/]+)\/children$/);
		if (request.method === 'GET' && childrenMatch) {
			sendJson(response, { MediaContainer: { Metadata: [] } });
			return;
		}

		const artworkWrite = path.match(/^\/library\/metadata\/([^/]+)\/(posters|arts)$/);
		if (request.method === 'POST' && artworkWrite) {
			const id = decodeURIComponent(artworkWrite[1]);
			const kind = artworkWrite[2] === 'posters' ? 'poster' : 'background';
			const externalUrl = url.searchParams.get('url');
			let bytes = await bodyBuffer(request);
			if (externalUrl) {
				const result = await fetch(externalUrl);
				bytes = Buffer.from(await result.arrayBuffer());
			}
			const slots = fixture.artwork.get(id) ?? {};
			slots[kind] = {
				tag: `upload-${fixture.nextRevision()}-${kind}`,
				bytes: bytes.length ? bytes : colorFromText(`fallback:${id}:${kind}`)
			};
			fixture.artwork.set(id, slots);
			response.writeHead(201);
			response.end();
			return;
		}

		const metadataMatch = path.match(/^\/library\/metadata\/([^/]+)$/);
		if (metadataMatch && request.method === 'PUT') {
			response.writeHead(200);
			response.end();
			return;
		}
		if (metadataMatch && request.method === 'GET') {
			const id = decodeURIComponent(metadataMatch[1]);
			const item =
				fixture.items.find((candidate) => candidate.ratingKey === id) ??
				(id === 'plex-collection'
					? { ratingKey: id, title: 'Plex E2E Collection', type: 'collection' }
					: null);
			if (!item) notFound(response);
			else sendJson(response, { MediaContainer: { Metadata: [metadata(item)] } });
			return;
		}

		if (request.method === 'GET' && path.startsWith('/assets/')) {
			sendImage(response, colorFromText(path));
			return;
		}
		notFound(response);
	});
}

function listen(server, port) {
	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(port, '127.0.0.1', () => {
			server.off('error', reject);
			resolve();
		});
	});
}

function close(server) {
	return new Promise((resolve) => server.close(() => resolve()));
}

export async function startFakeMediaServers({ jellyfinPort, plexPort }) {
	const jellyfin = createJellyfinServer();
	const plex = createPlexServer();
	await Promise.all([listen(jellyfin, jellyfinPort), listen(plex, plexPort)]);
	return {
		async close() {
			await Promise.all([close(jellyfin), close(plex)]);
		}
	};
}
