import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, ne } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	automationSchedules,
	serverInstances,
	settings,
	type ServerInstance
} from '$lib/server/db/schema';
import { decryptSecret, encryptSecret, isEncrypted } from '$lib/server/secrets/crypto';
import {
	LEGACY_SERVER_INSTANCE_ID,
	LEGACY_SERVER_INSTANCE_NAME,
	type LegacyServerConnection
} from './legacy';
import {
	ServerInstanceError,
	assertServerInstanceType,
	hasCredentialReplacement,
	normalizeServerBaseUrl,
	normalizeServerInstanceName,
	type ServerInstanceType
} from './validation';

export const ACTIVE_SERVER_INSTANCE_KEY = 'activeServerInstanceId';

type Database = LibSQLDatabase<typeof schema>;
type Executor = Pick<Database, 'select' | 'insert' | 'update' | 'delete'>;

export interface ServerInstanceSummary {
	id: string;
	name: string;
	type: ServerInstanceType;
	baseUrl: string | null;
	credentialSet: boolean;
	enabled: boolean;
	protected: boolean;
	connectionStatus: ServerInstance['connectionStatus'];
	lastTestedAt: Date | null;
	disconnectedAt: Date | null;
	createdAt: Date;
	updatedAt: Date;
}

export interface ServerInstanceConnection extends ServerInstanceSummary {
	credential: string | null;
	connectionSettings: Record<string, unknown> | null;
	capabilities: Record<string, unknown> | null;
}

export interface CreateServerInstanceInput {
	name: string;
	type: ServerInstanceType;
	baseUrl: string;
	credential: string;
	enabled?: boolean;
	connectionSettings?: Record<string, unknown> | null;
	capabilities?: Record<string, unknown> | null;
	connectionStatus?: ServerInstance['connectionStatus'];
	lastTestedAt?: Date | null;
}

export interface UpdateServerInstanceInput {
	name?: string;
	type?: ServerInstanceType;
	baseUrl?: string;
	/** Omitted or blank preserves the existing encrypted credential. */
	credential?: string;
	/** Clearing is deliberately separate from an omitted/masked form value. */
	clearCredential?: boolean;
	enabled?: boolean;
	connectionSettings?: Record<string, unknown> | null;
	capabilities?: Record<string, unknown> | null;
	connectionStatus?: ServerInstance['connectionStatus'];
	lastTestedAt?: Date | null;
}

export interface ServerInstanceStoreOptions {
	clock?: () => Date;
	generateId?: () => string;
}

function toSummary(row: ServerInstance): ServerInstanceSummary {
	return {
		id: row.id,
		name: row.name,
		type: row.type,
		baseUrl: row.baseUrl,
		credentialSet: row.credential !== null && row.credential !== '',
		enabled: row.enabled,
		protected: row.protected,
		connectionStatus: row.connectionStatus,
		lastTestedAt: row.lastTestedAt,
		disconnectedAt: row.disconnectedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

function jsonEqual(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function errorChainMatches(error: unknown, pattern: RegExp): boolean {
	let current = error;
	const visited = new Set<unknown>();
	while (current && !visited.has(current)) {
		visited.add(current);
		if (current instanceof Error && pattern.test(current.message)) return true;
		if (typeof current !== 'object') return false;
		const details = current as { cause?: unknown; code?: unknown; extendedCode?: unknown };
		if (
			pattern.test(String(details.code ?? '')) ||
			pattern.test(String(details.extendedCode ?? ''))
		) {
			return true;
		}
		current = details.cause;
	}
	return false;
}

function isForeignKeyError(error: unknown): boolean {
	return errorChainMatches(error, /foreign key constraint|constraint_foreignkey/i);
}

function isDuplicateNameError(error: unknown): boolean {
	return errorChainMatches(
		error,
		/(server_instances_active_name_unique|server_instances\.normalized_name|unique constraint)/i
	);
}

/** CRUD store with injected DB/key so all behavior is integration-testable without `$env`. */
export function createServerInstanceStore(
	database: Database,
	encryptionKey: Buffer,
	options: ServerInstanceStoreOptions = {}
) {
	const clock = options.clock ?? (() => new Date());
	const generateId = options.generateId ?? randomUUID;

	async function findRow(executor: Executor, id: string): Promise<ServerInstance | null> {
		return (
			(
				await executor.select().from(serverInstances).where(eq(serverInstances.id, id)).limit(1)
			)[0] ?? null
		);
	}

	async function activeSetting(executor: Executor): Promise<string | null> {
		const row = (
			await executor
				.select()
				.from(settings)
				.where(eq(settings.key, ACTIVE_SERVER_INSTANCE_KEY))
				.limit(1)
		)[0];
		return row?.value || null;
	}

	async function writeActiveSetting(executor: Executor, id: string | null): Promise<void> {
		if (id === null) {
			await executor.delete(settings).where(eq(settings.key, ACTIVE_SERVER_INSTANCE_KEY));
			return;
		}
		await executor
			.insert(settings)
			.values({ key: ACTIVE_SERVER_INSTANCE_KEY, value: id })
			.onConflictDoUpdate({ target: settings.key, set: { value: id } });
	}

	function isSelectable(row: ServerInstance | null): row is ServerInstance {
		return row !== null && row.enabled && row.disconnectedAt === null;
	}

	async function ensureActive(
		executor: Executor,
		preferredId?: string
	): Promise<ServerInstance | null> {
		const storedId = await activeSetting(executor);
		if (storedId) {
			const stored = await findRow(executor, storedId);
			if (isSelectable(stored)) return stored;
		}

		if (preferredId) {
			const preferred = await findRow(executor, preferredId);
			if (isSelectable(preferred)) {
				await writeActiveSetting(executor, preferred.id);
				return preferred;
			}
		}

		const fallback = (
			await executor
				.select()
				.from(serverInstances)
				.where(and(eq(serverInstances.enabled, true), isNull(serverInstances.disconnectedAt)))
				.orderBy(asc(serverInstances.createdAt), asc(serverInstances.name))
				.limit(1)
		)[0];
		await writeActiveSetting(executor, fallback?.id ?? null);
		return fallback ?? null;
	}

	async function assertUniqueActiveName(
		executor: Executor,
		normalizedName: string,
		enabled: boolean,
		excludeId?: string
	): Promise<void> {
		if (!enabled) return;
		const predicates = [
			eq(serverInstances.normalizedName, normalizedName),
			eq(serverInstances.enabled, true),
			isNull(serverInstances.disconnectedAt)
		];
		if (excludeId) predicates.push(ne(serverInstances.id, excludeId));
		const duplicate = (
			await executor
				.select({ id: serverInstances.id })
				.from(serverInstances)
				.where(and(...predicates))
				.limit(1)
		)[0];
		if (duplicate) throw new ServerInstanceError('duplicate_name');
	}

	async function list(): Promise<ServerInstanceSummary[]> {
		const rows = await database
			.select()
			.from(serverInstances)
			.orderBy(desc(serverInstances.enabled), asc(serverInstances.name));
		return rows.map(toSummary);
	}

	async function get(id: string): Promise<ServerInstanceSummary | null> {
		const row = await findRow(database, id);
		return row ? toSummary(row) : null;
	}

	async function create(input: CreateServerInstanceInput): Promise<ServerInstanceSummary> {
		assertServerInstanceType(input.type);
		const { name, normalizedName } = normalizeServerInstanceName(input.name);
		const baseUrl = normalizeServerBaseUrl(input.baseUrl);
		if (!hasCredentialReplacement(input.credential)) {
			throw new ServerInstanceError('credential_required');
		}
		const id = generateId();
		if (!id) throw new ServerInstanceError('server_instance_not_found');

		try {
			return await database.transaction(async (tx) => {
				const enabled = input.enabled ?? true;
				await assertUniqueActiveName(tx, normalizedName, enabled);
				const now = clock();
				const [row] = await tx
					.insert(serverInstances)
					.values({
						id,
						name,
						normalizedName,
						type: input.type,
						baseUrl,
						credential: encryptSecret(input.credential, encryptionKey),
						connectionSettings: input.connectionSettings ?? null,
						capabilities: input.capabilities ?? null,
						enabled,
						protected: false,
						connectionStatus: enabled ? (input.connectionStatus ?? 'unknown') : 'disabled',
						lastTestedAt: input.lastTestedAt ?? null,
						createdAt: now,
						updatedAt: now
					})
					.returning();
				await ensureActive(tx, row.id);
				return toSummary(row);
			});
		} catch (error) {
			if (error instanceof ServerInstanceError) throw error;
			if (isDuplicateNameError(error)) throw new ServerInstanceError('duplicate_name');
			throw error;
		}
	}

	async function update(
		id: string,
		input: UpdateServerInstanceInput
	): Promise<ServerInstanceSummary> {
		const replacementCredential = hasCredentialReplacement(input.credential)
			? input.credential
			: null;
		const replacement = replacementCredential !== null;
		if (replacement && input.clearCredential) {
			throw new ServerInstanceError('credential_update_conflict');
		}

		try {
			return await database.transaction(async (tx) => {
				const current = await findRow(tx, id);
				if (!current) throw new ServerInstanceError('server_instance_not_found');

				const normalized = input.name
					? normalizeServerInstanceName(input.name)
					: { name: current.name, normalizedName: current.normalizedName };
				const type = input.type ?? current.type;
				assertServerInstanceType(type);
				const baseUrl = input.baseUrl ? normalizeServerBaseUrl(input.baseUrl) : current.baseUrl;
				const enabled = input.enabled ?? current.enabled;
				await assertUniqueActiveName(tx, normalized.normalizedName, enabled, id);

				let credential = current.credential;
				if (replacementCredential !== null) {
					credential = encryptSecret(replacementCredential, encryptionKey);
				} else if (input.clearCredential) credential = null;

				let connectionStatus = input.connectionStatus ?? current.connectionStatus;
				if (input.enabled === false && input.connectionStatus === undefined) {
					connectionStatus = 'disabled';
				} else if (
					input.enabled === true &&
					current.connectionStatus === 'disabled' &&
					input.connectionStatus === undefined
				) {
					connectionStatus = 'unknown';
				}

				const [row] = await tx
					.update(serverInstances)
					.set({
						name: normalized.name,
						normalizedName: normalized.normalizedName,
						type,
						baseUrl,
						credential,
						enabled,
						connectionSettings:
							input.connectionSettings === undefined
								? current.connectionSettings
								: input.connectionSettings,
						capabilities:
							input.capabilities === undefined ? current.capabilities : input.capabilities,
						connectionStatus,
						lastTestedAt:
							input.lastTestedAt === undefined ? current.lastTestedAt : input.lastTestedAt,
						updatedAt: clock()
					})
					.where(eq(serverInstances.id, id))
					.returning();
				await ensureActive(tx, row.enabled ? row.id : undefined);
				return toSummary(row);
			});
		} catch (error) {
			if (error instanceof ServerInstanceError) throw error;
			if (isDuplicateNameError(error)) throw new ServerInstanceError('duplicate_name');
			throw error;
		}
	}

	async function remove(id: string): Promise<ServerInstanceSummary> {
		try {
			return await database.transaction(async (tx) => {
				const current = await findRow(tx, id);
				if (!current) throw new ServerInstanceError('server_instance_not_found');
				if (current.protected) throw new ServerInstanceError('server_instance_protected');
				const [deleted] = await tx
					.delete(serverInstances)
					.where(eq(serverInstances.id, id))
					.returning();
				await ensureActive(tx);
				return toSummary(deleted);
			});
		} catch (error) {
			if (error instanceof ServerInstanceError) throw error;
			if (isForeignKeyError(error)) throw new ServerInstanceError('server_instance_in_use');
			throw error;
		}
	}

	/** Retain scoped history while revoking operational access and stored credentials. */
	async function disconnect(id: string): Promise<ServerInstanceSummary> {
		return database.transaction(async (tx) => {
			const current = await findRow(tx, id);
			if (!current) throw new ServerInstanceError('server_instance_not_found');
			const now = clock();
			// A disconnected server remains historical data, but no persisted schedule may
			// enqueue new work until a future explicit reconnect flow exists.
			await tx
				.update(automationSchedules)
				.set({ enabled: false, pausedAt: now, nextRunAt: null, updatedAt: now })
				.where(eq(automationSchedules.serverInstanceId, id));
			if (current.disconnectedAt !== null) {
				await ensureActive(tx);
				return toSummary(current);
			}

			const [row] = await tx
				.update(serverInstances)
				.set({
					credential: null,
					enabled: false,
					connectionStatus: 'disabled',
					disconnectedAt: now,
					updatedAt: now
				})
				.where(eq(serverInstances.id, id))
				.returning();
			await ensureActive(tx);
			return toSummary(row);
		});
	}

	async function getConnection(
		id: string,
		options: { requireEnabled?: boolean } = {}
	): Promise<ServerInstanceConnection> {
		const row = await findRow(database, id);
		if (!row) throw new ServerInstanceError('server_instance_not_found');
		if (options.requireEnabled && !isSelectable(row)) {
			throw new ServerInstanceError('server_instance_disabled');
		}

		let credential: string | null = null;
		if (row.credential) {
			try {
				credential = decryptSecret(row.credential, encryptionKey);
			} catch {
				throw new ServerInstanceError('credential_unavailable');
			}
		}

		return {
			...toSummary(row),
			credential,
			connectionSettings: row.connectionSettings,
			capabilities: row.capabilities
		};
	}

	async function setActive(id: string): Promise<ServerInstanceSummary> {
		return database.transaction(async (tx) => {
			const row = await findRow(tx, id);
			if (!row) throw new ServerInstanceError('server_instance_not_found');
			if (!isSelectable(row)) throw new ServerInstanceError('server_instance_disabled');
			await writeActiveSetting(tx, row.id);
			return toSummary(row);
		});
	}

	async function getActive(): Promise<ServerInstanceSummary | null> {
		// Request-time resolution is deliberately read-only. The create/update/
		// disable/disconnect paths repair the persisted pointer transactionally; doing
		// that here makes the root layout and page loaders race for a SQLite write lock
		// on a fresh install, when there is not even a server to select yet.
		const storedId = await activeSetting(database);
		if (storedId) {
			const stored = await findRow(database, storedId);
			if (isSelectable(stored)) return toSummary(stored);
		}

		const fallback = (
			await database
				.select()
				.from(serverInstances)
				.where(and(eq(serverInstances.enabled, true), isNull(serverInstances.disconnectedAt)))
				.orderBy(asc(serverInstances.createdAt), asc(serverInstances.name))
				.limit(1)
		)[0];
		return fallback ? toSummary(fallback) : null;
	}

	async function materializeLegacy(
		connection: LegacyServerConnection
	): Promise<ServerInstanceSummary | null> {
		assertServerInstanceType(connection.type);
		const configured =
			typeof connection.baseUrl === 'string' &&
			connection.baseUrl.trim() !== '' &&
			typeof connection.credential === 'string' &&
			connection.credential.trim() !== '';

		// Once the protected legacy row and active pointer are already coherent, this
		// startup migration is a pair of ordinary reads. This matters in dev/HMR and
		// under concurrent startup probes: an unnecessary SQLite transaction per
		// module evaluation can contend even though there is nothing to write.
		const existing = await findRow(database, LEGACY_SERVER_INSTANCE_ID);
		if (!existing && !configured) return null;
		if (existing?.protected) {
			let connectionMatches = true;
			if (configured && existing.disconnectedAt === null) {
				let credentialMatches = false;
				if (existing.credential && isEncrypted(existing.credential)) {
					try {
						credentialMatches =
							decryptSecret(existing.credential, encryptionKey) === connection.credential;
					} catch {
						credentialMatches = false;
					}
				}
				connectionMatches =
					existing.type === connection.type &&
					existing.baseUrl === normalizeServerBaseUrl(connection.baseUrl!) &&
					credentialMatches &&
					(connection.connectionSettings === null ||
						jsonEqual(existing.connectionSettings, connection.connectionSettings));
			}

			if (connectionMatches) {
				const activeId = await activeSetting(database);
				const active = activeId ? await findRow(database, activeId) : null;
				if (isSelectable(active)) return toSummary(existing);
			}
		}

		try {
			return await database.transaction(async (tx) => {
				let row = await findRow(tx, LEGACY_SERVER_INSTANCE_ID);
				if (!row && !configured) return null;

				if (!row) {
					const normalized = normalizeServerInstanceName(LEGACY_SERVER_INSTANCE_NAME);
					await assertUniqueActiveName(tx, normalized.normalizedName, true);
					const now = clock();
					[row] = await tx
						.insert(serverInstances)
						.values({
							id: LEGACY_SERVER_INSTANCE_ID,
							name: normalized.name,
							normalizedName: normalized.normalizedName,
							type: connection.type,
							baseUrl: normalizeServerBaseUrl(connection.baseUrl!),
							credential: encryptSecret(connection.credential!, encryptionKey),
							connectionSettings: connection.connectionSettings,
							enabled: true,
							protected: true,
							connectionStatus: 'unknown',
							createdAt: now,
							updatedAt: now
						})
						.returning();
				} else {
					const changes: Partial<typeof serverInstances.$inferInsert> = {};
					if (!row.protected) changes.protected = true;

					// An explicitly disconnected legacy instance is historical; never rehydrate it
					// merely because old environment/settings values still exist.
					if (configured && row.disconnectedAt === null) {
						const baseUrl = normalizeServerBaseUrl(connection.baseUrl!);
						if (row.type !== connection.type) changes.type = connection.type;
						if (row.baseUrl !== baseUrl) changes.baseUrl = baseUrl;
						if (
							connection.connectionSettings !== null &&
							!jsonEqual(row.connectionSettings, connection.connectionSettings)
						) {
							changes.connectionSettings = connection.connectionSettings;
						}

						let replaceCredential = !row.credential || !isEncrypted(row.credential);
						if (row.credential && isEncrypted(row.credential)) {
							try {
								replaceCredential =
									decryptSecret(row.credential, encryptionKey) !== connection.credential;
							} catch {
								replaceCredential = true;
							}
						}
						if (replaceCredential) {
							changes.credential = encryptSecret(connection.credential!, encryptionKey);
						}
					}

					if (Object.keys(changes).length > 0) {
						changes.updatedAt = clock();
						[row] = await tx
							.update(serverInstances)
							.set(changes)
							.where(eq(serverInstances.id, row.id))
							.returning();
					}
				}

				await ensureActive(tx, row.enabled && row.disconnectedAt === null ? row.id : undefined);
				return toSummary(row);
			});
		} catch (error) {
			if (error instanceof ServerInstanceError) throw error;
			if (isDuplicateNameError(error)) throw new ServerInstanceError('duplicate_name');
			throw error;
		}
	}

	return {
		list,
		get,
		create,
		update,
		remove,
		disconnect,
		getConnection,
		setActive,
		getActive,
		materializeLegacy
	};
}

export type ServerInstanceStore = ReturnType<typeof createServerInstanceStore>;
