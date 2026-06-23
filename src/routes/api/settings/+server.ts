import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveSettings, type AppConfig } from '$lib/server/config';
import { logEvent } from '$lib/server/events';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const payload: Partial<Record<keyof AppConfig, string>> = {};
	let includedSectionsChanged = false;
	for (const [key, value] of Object.entries(body)) {
		// includedSections is an array of section keys → persist as JSON.
		if (key === 'includedSections' && Array.isArray(value)) {
			payload.includedSections = JSON.stringify(value);
			includedSectionsChanged = true;
		} else if (typeof value === 'string') {
			(payload as Record<string, string>)[key] = value;
		}
	}
	await saveSettings(payload);

	// Log which settings changed for the activity log — never log secret VALUES,
	// only that a secret key was updated.
	const changedKeys = Object.keys(payload);
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
			{ count }
		);
	}

	return json({ ok: true });
};
