export type DiagnosticComponentType =
	| 'server'
	| 'tmdb'
	| 'artwork_provider'
	| 'kometa'
	| 'data_path'
	| 'backup_path';

export type DiagnosticStatus = 'healthy' | 'degraded' | 'unavailable' | 'disabled' | 'unknown';

export type DiagnosticCredentialStatus =
	| 'not_applicable'
	| 'valid'
	| 'missing'
	| 'rejected'
	| 'unknown';

export interface DiagnosticPathChecks {
	[key: string]: unknown;
	path: string;
	exists: boolean;
	expectedType: 'file' | 'directory';
	actualType: 'file' | 'directory' | 'other' | 'missing';
	readable: boolean;
	writable: boolean;
	probeCleaned: boolean;
}

export interface DiagnosticObservation {
	capabilities?: Record<string, unknown> | null;
	pathChecks?: DiagnosticPathChecks | null;
}

export interface DiagnosticDefinition {
	componentType: DiagnosticComponentType;
	componentKey: string;
	serverInstanceId?: string | null;
	enabled?: boolean;
	credentialRequired?: boolean;
	credentialPresent?: boolean;
	timeoutMs?: number;
	/** A failed artwork provider remains useful when stale last-known-good assets exist. */
	degradedOnFailure?: boolean;
	lastSuccessAt?: Date | null;
	check: () => Promise<DiagnosticObservation | void>;
}

export interface DiagnosticResultValue {
	serverInstanceId: string | null;
	componentType: DiagnosticComponentType;
	componentKey: string;
	status: DiagnosticStatus;
	credentialStatus: DiagnosticCredentialStatus;
	latencyMs: number | null;
	lastSuccessAt: Date | null;
	capabilities: Record<string, unknown> | null;
	pathChecks: DiagnosticPathChecks | null;
	errorCode: string | null;
	error: string | null;
	checkedAt: Date;
}

export class DiagnosticCheckError extends Error {
	constructor(
		public readonly code: string,
		message: string,
		public readonly credentialRejected = false,
		public readonly observation: DiagnosticObservation = {}
	) {
		super(message);
		this.name = 'DiagnosticCheckError';
	}
}
