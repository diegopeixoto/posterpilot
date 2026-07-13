import { describe, expect, it } from 'vitest';
import { DiagnosticCheckError, type DiagnosticDefinition } from './types';
import { runDiagnosticCheck, runDiagnosticChecks } from './runner';

function definition(overrides: Partial<DiagnosticDefinition> = {}): DiagnosticDefinition {
	return {
		componentType: 'tmdb',
		componentKey: 'tmdb',
		check: async () => undefined,
		...overrides
	};
}

describe('diagnostic runner', () => {
	it('reports healthy checks with structured credential and capability state', async () => {
		const result = await runDiagnosticCheck(
			definition({
				credentialRequired: true,
				credentialPresent: true,
				check: async () => ({ capabilities: { posterWrite: true } })
			})
		);
		expect(result.status).toBe('healthy');
		expect(result.credentialStatus).toBe('valid');
		expect(result.capabilities).toEqual({ posterWrite: true });
		expect(result.lastSuccessAt).toBeInstanceOf(Date);
	});

	it('does not invoke disabled or missing-credential checks', async () => {
		let calls = 0;
		const results = await runDiagnosticChecks([
			definition({ enabled: false, check: async () => void calls++ }),
			definition({
				componentKey: 'fanarttv',
				credentialRequired: true,
				credentialPresent: false,
				check: async () => void calls++
			})
		]);
		expect(calls).toBe(0);
		expect(results.map((result) => result.status)).toEqual(['disabled', 'unavailable']);
		expect(results[1].credentialStatus).toBe('missing');
	});

	it('times out one check while completing the others', async () => {
		const completed: string[] = [];
		const results = await runDiagnosticChecks(
			[
				definition({
					componentKey: 'slow',
					timeoutMs: 5,
					check: () => new Promise(() => {})
				}),
				definition({ componentKey: 'fast' })
			],
			undefined,
			(result) => {
				completed.push(result.componentKey);
			}
		);
		expect(results[0]).toMatchObject({ status: 'unavailable', errorCode: 'timeout' });
		expect(results[1].status).toBe('healthy');
		expect(completed).toEqual(['fast', 'slow']);
	});

	it('distinguishes rejected credentials and degrades providers with stale assets', async () => {
		const result = await runDiagnosticCheck(
			definition({
				componentType: 'artwork_provider',
				credentialRequired: true,
				credentialPresent: true,
				degradedOnFailure: true,
				lastSuccessAt: new Date('2025-01-01T00:00:00Z'),
				check: async () => {
					throw new DiagnosticCheckError(
						'credential_rejected',
						'secret-bearing upstream text',
						true
					);
				}
			})
		);
		expect(result).toMatchObject({
			status: 'degraded',
			credentialStatus: 'rejected',
			errorCode: 'credential_rejected',
			error: 'The configured credential was rejected.'
		});
		expect(result.error).not.toContain('secret-bearing');
	});
});
