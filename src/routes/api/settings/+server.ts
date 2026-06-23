import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { saveSettings, type AppConfig } from '$lib/server/config';

export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
	const payload: Partial<Record<keyof AppConfig, string>> = {};
	for (const [key, value] of Object.entries(body)) {
		// includedSections is an array of section keys → persist as JSON.
		if (key === 'includedSections' && Array.isArray(value)) {
			payload.includedSections = JSON.stringify(value);
		} else if (typeof value === 'string') {
			(payload as Record<string, string>)[key] = value;
		}
	}
	await saveSettings(payload);
	return json({ ok: true });
};
