import type { AppConfig } from './index';

const SECRET_FIELDS = [
	'plexToken',
	'jellyfinApiKey',
	'embyApiKey',
	'tmdbKey',
	'fanartKey'
] as const;

/** Redact known configured secret values without importing runtime environment state. */
export function redact(text: string, config: AppConfig): string {
	let out = text;
	for (const key of SECRET_FIELDS) {
		const secret = config[key];
		if (secret && secret.length >= 4) out = out.split(secret).join('***');
	}
	return out;
}
