import type { ConnectionResult, MediaServer } from '$lib/server/media-server/types';
import type {
	ServerInstanceConnection,
	ServerInstanceStore,
	ServerInstanceSummary,
	UpdateServerInstanceInput
} from './store';
import {
	ServerInstanceError,
	assertServerInstanceType,
	hasCredentialReplacement,
	normalizeServerBaseUrl,
	normalizeServerInstanceName,
	type ServerInstanceType
} from './validation';

type ManagementStore = Pick<
	ServerInstanceStore,
	'list' | 'getActive' | 'create' | 'update' | 'getConnection' | 'disconnect'
>;

export interface ServerConnectionCandidate {
	serverId: string | null;
	type: ServerInstanceType;
	baseUrl: string;
	credential: string;
	connectionSettings: Record<string, unknown> | null;
}

export type ServerProviderFactory = (
	candidate: ServerConnectionCandidate
) => Pick<MediaServer, 'testConnection' | 'capabilities'>;

export interface AddManagedServerInput {
	name: string;
	type: ServerInstanceType;
	baseUrl: string;
	credential: string;
	connectionSettings?: Record<string, unknown> | null;
}

export interface TestManagedServerInput {
	id?: string;
	type?: ServerInstanceType;
	baseUrl?: string;
	credential?: string;
	connectionSettings?: Record<string, unknown> | null;
}

export interface UpdateManagedServerInput {
	name?: string;
	type?: ServerInstanceType;
	baseUrl?: string;
	/** Omitted, blank, or a standard mask preserves the stored credential. */
	credential?: string;
	connectionSettings?: Record<string, unknown> | null;
}

export type ManagedConnectionStatus = 'healthy' | 'unauthorized' | 'unreachable';

export interface ManagedConnectionTestResult {
	ok: boolean;
	status: ManagedConnectionStatus;
	serverId?: string;
	testedAt: string;
	serverName?: string;
	version?: string;
	error?: {
		code: 'connection_unauthorized' | 'connection_unreachable';
	};
}

interface ConnectionTestOutcome {
	result: ManagedConnectionTestResult;
	testedAt: Date;
	capabilities: Record<string, unknown>;
}

export interface ServerManagementOptions {
	clock?: () => Date;
	providerFactory: ServerProviderFactory;
}

function summaryFromConnection(connection: ServerInstanceConnection): ServerInstanceSummary {
	return {
		id: connection.id,
		name: connection.name,
		type: connection.type,
		baseUrl: connection.baseUrl,
		credentialSet: connection.credentialSet,
		enabled: connection.enabled,
		protected: connection.protected,
		connectionStatus: connection.connectionStatus,
		lastTestedAt: connection.lastTestedAt,
		disconnectedAt: connection.disconnectedAt,
		createdAt: connection.createdAt,
		updatedAt: connection.updatedAt
	};
}

function jsonEqual(left: unknown, right: unknown): boolean {
	return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

/** Domain service for server-management routes, with injectable providers and storage. */
export function createServerManagementService(
	store: ManagementStore,
	options: ServerManagementOptions
) {
	const clock = options.clock ?? (() => new Date());
	const providerFactory = options.providerFactory;

	async function resolveCandidate(
		input: TestManagedServerInput,
		current?: ServerInstanceConnection
	): Promise<ServerConnectionCandidate> {
		const type = input.type ?? current?.type;
		if (!type) throw new ServerInstanceError('invalid_server_type');
		assertServerInstanceType(type);

		const rawBaseUrl = input.baseUrl === undefined ? current?.baseUrl : input.baseUrl;
		if (!rawBaseUrl) throw new ServerInstanceError('invalid_base_url');
		const baseUrl = normalizeServerBaseUrl(rawBaseUrl);

		const credential = hasCredentialReplacement(input.credential)
			? input.credential
			: current?.credential;
		if (!credential) throw new ServerInstanceError('credential_required');

		return {
			serverId: current?.id ?? null,
			type,
			baseUrl,
			credential,
			connectionSettings:
				input.connectionSettings === undefined
					? (current?.connectionSettings ?? null)
					: input.connectionSettings
		};
	}

	async function runConnectionTest(
		candidate: ServerConnectionCandidate
	): Promise<ConnectionTestOutcome> {
		let providerResult: ConnectionResult;
		const provider = providerFactory(candidate);
		try {
			providerResult = await provider.testConnection();
		} catch {
			providerResult = { ok: false };
		}
		const testedAt = clock();
		const common = {
			...(candidate.serverId ? { serverId: candidate.serverId } : {}),
			testedAt: testedAt.toISOString()
		};

		if (providerResult.ok) {
			return {
				testedAt,
				capabilities: provider.capabilities,
				result: {
					ok: true,
					status: 'healthy',
					...common,
					...(providerResult.serverName ? { serverName: providerResult.serverName } : {}),
					...(providerResult.version ? { version: providerResult.version } : {})
				}
			};
		}

		const unauthorized = providerResult.unauthorized === true;
		return {
			testedAt,
			capabilities: provider.capabilities,
			result: {
				ok: false,
				status: unauthorized ? 'unauthorized' : 'unreachable',
				...common,
				error: {
					code: unauthorized ? 'connection_unauthorized' : 'connection_unreachable'
				}
			}
		};
	}

	async function recordOutcome(id: string, outcome: ConnectionTestOutcome): Promise<void> {
		await store.update(id, {
			connectionStatus: outcome.result.status,
			lastTestedAt: outcome.testedAt,
			...(outcome.result.ok ? { capabilities: outcome.capabilities } : {})
		});
	}

	function requireSuccessful(outcome: ConnectionTestOutcome): void {
		if (outcome.result.ok) return;
		throw new ServerInstanceError(outcome.result.error!.code);
	}

	async function list() {
		// `getActive()` may repair a stale setting transactionally. Keep it sequential
		// with the list read because the embedded SQLite client allows one transaction
		// at a time on this connection.
		const active = await store.getActive();
		const servers = await store.list();
		return { servers, activeServerId: active?.id ?? null };
	}

	async function test(input: TestManagedServerInput): Promise<ManagedConnectionTestResult> {
		const current = input.id ? await store.getConnection(input.id) : undefined;
		if (current?.disconnectedAt) throw new ServerInstanceError('server_instance_disconnected');
		const candidate = await resolveCandidate(input, current);
		const outcome = await runConnectionTest(candidate);
		if (current) await recordOutcome(current.id, outcome);
		return outcome.result;
	}

	async function add(input: AddManagedServerInput): Promise<ServerInstanceSummary> {
		normalizeServerInstanceName(input.name);
		const candidate = await resolveCandidate(input);
		const outcome = await runConnectionTest(candidate);
		requireSuccessful(outcome);

		return store.create({
			name: input.name,
			type: candidate.type,
			baseUrl: candidate.baseUrl,
			credential: candidate.credential,
			connectionSettings: candidate.connectionSettings,
			capabilities: outcome.capabilities,
			connectionStatus: 'healthy',
			lastTestedAt: outcome.testedAt
		});
	}

	async function update(
		id: string,
		input: UpdateManagedServerInput
	): Promise<ServerInstanceSummary> {
		const current = await store.getConnection(id);
		if (current.disconnectedAt) throw new ServerInstanceError('server_instance_disconnected');
		if (input.name !== undefined) normalizeServerInstanceName(input.name);

		const replacementCredential = hasCredentialReplacement(input.credential)
			? input.credential
			: undefined;
		const hasConnectionInput =
			input.type !== undefined ||
			input.baseUrl !== undefined ||
			replacementCredential !== undefined ||
			input.connectionSettings !== undefined;

		const updates: UpdateServerInstanceInput = {};
		if (input.name !== undefined) updates.name = input.name;
		if (!hasConnectionInput) {
			return Object.keys(updates).length > 0
				? store.update(id, updates)
				: summaryFromConnection(current);
		}

		const candidate = await resolveCandidate(
			{
				type: input.type,
				baseUrl: input.baseUrl,
				credential: replacementCredential,
				connectionSettings: input.connectionSettings
			},
			current
		);
		const connectionChanged =
			candidate.type !== current.type ||
			candidate.baseUrl !== current.baseUrl ||
			candidate.credential !== current.credential ||
			!jsonEqual(candidate.connectionSettings, current.connectionSettings);

		if (input.type !== undefined) updates.type = candidate.type;
		if (input.baseUrl !== undefined) updates.baseUrl = candidate.baseUrl;
		if (replacementCredential !== undefined) updates.credential = replacementCredential;
		if (input.connectionSettings !== undefined) {
			updates.connectionSettings = candidate.connectionSettings;
		}

		if (!connectionChanged) {
			return Object.keys(updates).length > 0
				? store.update(id, updates)
				: summaryFromConnection(current);
		}

		const outcome = await runConnectionTest(candidate);
		if (!outcome.result.ok) {
			// Record the attempted test against this instance, but never replace the
			// previously working connection details after a failed test.
			await recordOutcome(id, outcome);
			requireSuccessful(outcome);
		}

		updates.connectionStatus = 'healthy';
		updates.lastTestedAt = outcome.testedAt;
		updates.capabilities = outcome.capabilities;
		return store.update(id, updates);
	}

	async function enable(id: string): Promise<ServerInstanceSummary> {
		const current = await store.getConnection(id);
		if (current.disconnectedAt) throw new ServerInstanceError('server_instance_disconnected');
		const candidate = await resolveCandidate({}, current);
		const outcome = await runConnectionTest(candidate);
		if (!outcome.result.ok) {
			await recordOutcome(id, outcome);
			requireSuccessful(outcome);
		}
		return store.update(id, {
			enabled: true,
			connectionStatus: 'healthy',
			lastTestedAt: outcome.testedAt,
			capabilities: outcome.capabilities
		});
	}

	async function disable(id: string): Promise<ServerInstanceSummary> {
		return store.update(id, { enabled: false });
	}

	async function disconnect(id: string, confirmed: boolean): Promise<ServerInstanceSummary> {
		if (!confirmed) throw new ServerInstanceError('disconnect_confirmation_required');
		return store.disconnect(id);
	}

	return { list, test, add, update, enable, disable, disconnect };
}

export type ServerManagementService = ReturnType<typeof createServerManagementService>;
