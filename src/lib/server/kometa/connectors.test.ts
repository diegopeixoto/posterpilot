import { describe, expect, it } from 'vitest';
import {
	CONNECTORS,
	CONNECTOR_DEPENDENCIES,
	SECRET_PATHS,
	connectorBySection,
	secretFieldKeys,
	connectorDoc
} from './connectors';

describe('kometa/connectors', () => {
	it('looks up a connector by section', () => {
		const plex = connectorBySection('plex');
		expect(plex?.section).toBe('plex');
		expect(connectorBySection('__nope__')).toBeUndefined();
	});

	it('reports secret field keys for a connector', () => {
		// Plex's token is a secret field.
		expect(secretFieldKeys('plex').has('token')).toBe(true);
		expect(secretFieldKeys('__nope__').size).toBe(0);
	});

	it('every dependency references a real connector (no typos)', () => {
		for (const dep of CONNECTOR_DEPENDENCIES) {
			expect(connectorBySection(dep.requiresConnector), dep.requiresConnector).toBeDefined();
		}
	});

	it('every connector section is unique', () => {
		const sections = CONNECTORS.map((c) => c.section);
		expect(new Set(sections).size).toBe(sections.length);
	});

	it('exposes a non-empty set of secret paths and never throws on doc lookup', () => {
		expect(SECRET_PATHS.size).toBeGreaterThan(0);
		expect(SECRET_PATHS).toContain('webhooks.error');
		expect(SECRET_PATHS).toContain('webhooks.run_start');
		expect(SECRET_PATHS).toContain('webhooks.run_end');
		for (const c of CONNECTORS) expect(() => connectorDoc(c.section)).not.toThrow();
		expect(connectorDoc('__nope__')).toBeUndefined();
	});
});
