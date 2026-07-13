import { readFileSync } from 'node:fs';

const catalog = JSON.parse(
	readFileSync(new URL('../../../messages/en.json', import.meta.url), 'utf8')
);

/** Resolve the real English catalog text so browser selectors track product copy. */
export function t(key, parameters = {}) {
	const template = catalog[key];
	if (typeof template !== 'string') throw new Error(`Missing English message: ${key}`);
	return template.replace(/\{([^}]+)\}/g, (match, name) =>
		Object.hasOwn(parameters, name) ? String(parameters[name]) : match
	);
}
