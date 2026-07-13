import { db } from '$lib/server/db';
import { resolveConfig } from '$lib/server/config';
import { createMediaServer } from '$lib/server/media-server';
import { getEncryptionKey } from '$lib/server/secrets/key';
import { legacyServerConnectionFromConfig } from './legacy';
import {
	createServerManagementService,
	type AddManagedServerInput,
	type TestManagedServerInput,
	type UpdateManagedServerInput
} from './management';
import { createServerInstanceStore } from './store';

// Deliberately lazy: hooks imports this module before migrations run, so resolving the
// encryption key or touching `server_instances` at module evaluation would be premature.
function liveStore() {
	return createServerInstanceStore(db, getEncryptionKey());
}

function liveManagementService() {
	return createServerManagementService(liveStore(), {
		providerFactory: (candidate) =>
			createMediaServer({
				instanceId: candidate.serverId,
				type: candidate.type,
				baseUrl: candidate.baseUrl,
				credential: candidate.credential
			})
	});
}

export const listServerInstances = () => liveStore().list();
export const getServerInstance = (id: string) => liveStore().get(id);
export const getServerInstanceConnection = (
	id: string,
	options: { requireEnabled?: boolean } = {}
) => liveStore().getConnection(id, options);
export const setActiveServerInstance = (id: string) => liveStore().setActive(id);
export const getActiveServerInstance = () => liveStore().getActive();

/** Resolve one validated named instance to its credentials-bound provider. */
export async function resolveMediaServerInstance(
	id: string,
	options: { requireEnabled?: boolean } = { requireEnabled: true }
) {
	if (!id) throw new TypeError('server instance id is required');
	const connection = await getServerInstanceConnection(id, options);
	if (!connection.baseUrl || !connection.credential) {
		throw new Error('server_instance_not_configured');
	}
	return {
		connection,
		server: createMediaServer({
			instanceId: connection.id,
			name: connection.name,
			type: connection.type,
			baseUrl: connection.baseUrl,
			credential: connection.credential,
			capabilities: connection.capabilities
		})
	};
}

export const listManagedServers = () => liveManagementService().list();
export const addManagedServer = (input: AddManagedServerInput) =>
	liveManagementService().add(input);
export const testManagedServer = (input: TestManagedServerInput) =>
	liveManagementService().test(input);
export const updateManagedServer = (id: string, input: UpdateManagedServerInput) =>
	liveManagementService().update(id, input);
export const enableManagedServer = (id: string) => liveManagementService().enable(id);
export const disableManagedServer = (id: string) => liveManagementService().disable(id);
export const disconnectManagedServer = (id: string, confirmed: boolean) =>
	liveManagementService().disconnect(id, confirmed);

/** Materialize the effective environment-over-persisted legacy connection exactly once. */
export async function materializeLegacyServerInstance() {
	const config = await resolveConfig();
	return liveStore().materializeLegacy(legacyServerConnectionFromConfig(config));
}

export * from './legacy';
export * from './management';
export * from './store';
export * from './validation';
