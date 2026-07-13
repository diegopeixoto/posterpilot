import type {
	DiagnosticCredentialStatus,
	DiagnosticDefinition,
	DiagnosticObservation,
	DiagnosticResultValue
} from './types';
import { DiagnosticCheckError } from './types';

const DEFAULT_TIMEOUT_MS = 8_000;

const SAFE_ERRORS: Record<string, string> = {
	timeout: 'The component did not respond before the diagnostic deadline.',
	credential_rejected: 'The configured credential was rejected.',
	network_unavailable: 'The component could not be reached.',
	path_missing: 'The configured path does not exist.',
	path_type_mismatch: 'The configured path has the wrong type.',
	path_unreadable: 'The configured path is not readable.',
	path_unwritable: 'The configured path is not writable.',
	check_failed: 'The diagnostic check did not complete successfully.'
};

function safeFailure(error: unknown): DiagnosticCheckError {
	if (error instanceof DiagnosticCheckError) {
		return new DiagnosticCheckError(
			error.code,
			SAFE_ERRORS[error.code] ?? SAFE_ERRORS.check_failed,
			error.credentialRejected,
			error.observation
		);
	}
	return new DiagnosticCheckError('network_unavailable', SAFE_ERRORS.network_unavailable);
}

function deadline<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timedOut = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new DiagnosticCheckError('timeout', SAFE_ERRORS.timeout)),
			Math.max(1, timeoutMs)
		);
	});
	return Promise.race([promise, timedOut]).finally(() => {
		if (timer) clearTimeout(timer);
	});
}

function baseResult(
	definition: DiagnosticDefinition,
	checkedAt: Date,
	credentialStatus: DiagnosticCredentialStatus
): Pick<
	DiagnosticResultValue,
	'serverInstanceId' | 'componentType' | 'componentKey' | 'checkedAt' | 'credentialStatus'
> {
	return {
		serverInstanceId: definition.serverInstanceId ?? null,
		componentType: definition.componentType,
		componentKey: definition.componentKey,
		checkedAt,
		credentialStatus
	};
}

/** Run one independent check with a hard caller-visible deadline and safe errors. */
export async function runDiagnosticCheck(
	definition: DiagnosticDefinition,
	clock: () => Date = () => new Date()
): Promise<DiagnosticResultValue> {
	const checkedAt = clock();
	const credentialStatus: DiagnosticCredentialStatus = definition.credentialRequired
		? definition.credentialPresent
			? 'unknown'
			: 'missing'
		: 'not_applicable';

	if (definition.enabled === false) {
		return {
			...baseResult(definition, checkedAt, credentialStatus),
			status: 'disabled',
			latencyMs: null,
			lastSuccessAt: definition.lastSuccessAt ?? null,
			capabilities: null,
			pathChecks: null,
			errorCode: null,
			error: null
		};
	}

	if (definition.credentialRequired && !definition.credentialPresent) {
		return {
			...baseResult(definition, checkedAt, 'missing'),
			status: 'unavailable',
			latencyMs: null,
			lastSuccessAt: definition.lastSuccessAt ?? null,
			capabilities: null,
			pathChecks: null,
			errorCode: 'credential_missing',
			error: 'A required credential is not configured.'
		};
	}

	const started = performance.now();
	try {
		const observation: DiagnosticObservation =
			(await deadline(definition.check(), definition.timeoutMs ?? DEFAULT_TIMEOUT_MS)) ?? {};
		const completedAt = clock();
		return {
			...baseResult(
				definition,
				checkedAt,
				definition.credentialRequired ? 'valid' : 'not_applicable'
			),
			status: 'healthy',
			latencyMs: Math.max(0, Math.round(performance.now() - started)),
			lastSuccessAt: completedAt,
			capabilities: observation.capabilities ?? null,
			pathChecks: observation.pathChecks ?? null,
			errorCode: null,
			error: null
		};
	} catch (unknownError) {
		const failure = safeFailure(unknownError);
		return {
			...baseResult(
				definition,
				checkedAt,
				failure.credentialRejected
					? 'rejected'
					: definition.credentialRequired
						? 'unknown'
						: 'not_applicable'
			),
			status: definition.degradedOnFailure ? 'degraded' : 'unavailable',
			latencyMs: Math.max(0, Math.round(performance.now() - started)),
			lastSuccessAt: definition.lastSuccessAt ?? null,
			capabilities: failure.observation.capabilities ?? null,
			pathChecks: failure.observation.pathChecks ?? null,
			errorCode: failure.code,
			error: failure.message
		};
	}
}

/** Checks are isolated: one failure or timeout never prevents the remaining checks. */
export async function runDiagnosticChecks(
	definitions: DiagnosticDefinition[],
	clock: () => Date = () => new Date(),
	onResult?: (result: DiagnosticResultValue) => void | Promise<void>
): Promise<DiagnosticResultValue[]> {
	return Promise.all(
		definitions.map(async (definition) => {
			const result = await runDiagnosticCheck(definition, clock);
			await onResult?.(result);
			return result;
		})
	);
}
