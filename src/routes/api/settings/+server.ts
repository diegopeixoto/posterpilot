import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	saveSettings,
	setArtworkRankingSettings,
	setIncludedSectionsForServer,
	type AppConfig
} from '$lib/server/config';
import { logEvent } from '$lib/server/events';
import { parseProviderPriority, parseScoreWeights } from '$lib/server/posters/score';
import {
	getActiveServerInstance,
	materializeLegacyServerInstance
} from '$lib/server/server-instances';
import { resolveKometaServerBinding } from '$lib/server/kometa/server-binding';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const payload: Partial<Record<keyof AppConfig, string>> = {};
	let ranking: {
		providerPriority: string[];
		weights: NonNullable<ReturnType<typeof parseScoreWeights>>;
	} | null = null;
	let includedSectionsChanged = false;
	let includedSections: string[] | null = null;
	let includedSectionsServerId: string | null = null;
	for (const [key, value] of Object.entries(body)) {
		if (key === 'ranking' && value && typeof value === 'object' && !Array.isArray(value)) {
			const raw = value as Record<string, unknown>;
			const providerPriority = parseProviderPriority(raw.providerPriority);
			const weights = parseScoreWeights(raw.weights);
			if (!providerPriority || !weights) {
				return json({ error: { code: 'invalid_artwork_ranking' } }, { status: 400 });
			}
			ranking = { providerPriority, weights };
			continue;
		}
		// includedSections is an array of section keys → persist as JSON.
		if (key === 'includedSections' && Array.isArray(value)) {
			if (value.some((entry) => typeof entry !== 'string')) {
				return json({ error: { code: 'invalid_library_selection' } }, { status: 400 });
			}
			includedSections = value as string[];
			includedSectionsChanged = true;
		} else if (typeof value === 'string') {
			(payload as Record<string, string>)[key] = value;
		}
	}
	if (typeof payload.kometaServerInstanceId === 'string' && payload.kometaServerInstanceId) {
		const resolved = await resolveKometaServerBinding(payload.kometaServerInstanceId);
		if (resolved.status !== 'ready') {
			return json({ error: { code: `kometa_server_binding_${resolved.status}` } }, { status: 400 });
		}
	}
	if (includedSections !== null) {
		const active = await getActiveServerInstance();
		if (!active) {
			return json({ error: { code: 'server_instance_not_found' } }, { status: 409 });
		}
		includedSectionsServerId = active.id;
		await setIncludedSectionsForServer(active.id, includedSections);
	}
	await saveSettings(payload);
	if (
		[
			'serverType',
			'plexUrl',
			'plexToken',
			'jellyfinUrl',
			'jellyfinApiKey',
			'embyUrl',
			'embyApiKey'
		].some((key) => key in payload)
	) {
		await materializeLegacyServerInstance();
	}
	if (ranking) await setArtworkRankingSettings(ranking);

	// Log which settings changed for the activity log — never log secret VALUES,
	// only that a secret key was updated.
	const changedKeys = [
		...Object.keys(payload),
		...(includedSectionsChanged ? ['includedSections'] : []),
		...(ranking ? ['artworkRanking'] : [])
	];
	if (changedKeys.length) {
		await logEvent('info', 'settings', 'Settings updated', { keys: changedKeys });
	}
	if (includedSectionsChanged) {
		const count = Array.isArray(body.includedSections) ? body.includedSections.length : 0;
		await logEvent(
			'info',
			'settings',
			count === 0
				? 'Library selection changed (sync all libraries)'
				: `Library selection changed (${count} libraries)`,
			{ count, serverInstanceId: includedSectionsServerId }
		);
	}

	return json({ ok: true });
};
