import type { Client, Row } from '@libsql/client';

interface ScopeRelation {
	name: string;
	childTable: string;
	childReferenceColumn: string;
	parentTable: string;
	parentIdColumn: string;
}

const NAMESPACE_ROOTS = ['media_items', 'media_collections'] as const;

/**
 * Every direct server-scoped item/collection relationship in the current schema.
 * Older restore snapshots are supported: a relation is checked only after the child
 * has both the reference and `server_instance_id` columns introduced by migration 0008.
 */
const SCOPE_RELATIONS: readonly ScopeRelation[] = [
	{
		name: 'poster_candidates.media_item_id',
		childTable: 'poster_candidates',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'child_selections.media_item_id',
		childTable: 'child_selections',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'applied_posters.media_item_id',
		childTable: 'applied_posters',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'job_item_outcomes.media_item_id',
		childTable: 'job_item_outcomes',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'events.media_item_id',
		childTable: 'events',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'collection_memberships.media_item_id',
		childTable: 'collection_memberships',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'collection_memberships.collection_id',
		childTable: 'collection_memberships',
		childReferenceColumn: 'collection_id',
		parentTable: 'media_collections',
		parentIdColumn: 'id'
	},
	{
		name: 'artwork_slot_states.media_item_id',
		childTable: 'artwork_slot_states',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'artwork_slot_states.media_collection_id',
		childTable: 'artwork_slot_states',
		childReferenceColumn: 'media_collection_id',
		parentTable: 'media_collections',
		parentIdColumn: 'id'
	},
	{
		name: 'artwork_snapshots.media_item_id',
		childTable: 'artwork_snapshots',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'artwork_snapshots.media_collection_id',
		childTable: 'artwork_snapshots',
		childReferenceColumn: 'media_collection_id',
		parentTable: 'media_collections',
		parentIdColumn: 'id'
	},
	{
		name: 'artwork_revisions.media_item_id',
		childTable: 'artwork_revisions',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'artwork_revisions.media_collection_id',
		childTable: 'artwork_revisions',
		childReferenceColumn: 'media_collection_id',
		parentTable: 'media_collections',
		parentIdColumn: 'id'
	},
	{
		name: 'provider_discovery_runs.media_item_id',
		childTable: 'provider_discovery_runs',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'provider_discovery_outcomes.media_item_id',
		childTable: 'provider_discovery_outcomes',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'review_events.media_item_id',
		childTable: 'review_events',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	},
	{
		name: 'resolution_audits.media_item_id',
		childTable: 'resolution_audits',
		childReferenceColumn: 'media_item_id',
		parentTable: 'media_items',
		parentIdColumn: 'id'
	}
] as const;

export interface ScopeIntegrityViolation {
	relation: string;
	rows: number;
}

export interface ScopeIntegrityResult {
	ok: boolean;
	violationCount: number;
	checkedRelations: number;
	violations: ScopeIntegrityViolation[];
}

function identifier(value: string): string {
	return `"${value.replaceAll('"', '""')}"`;
}

function rowValue(row: Row | undefined, name: string, index: number): unknown {
	return row?.[name] ?? row?.[index];
}

function countValue(value: unknown): number {
	const count = typeof value === 'bigint' ? Number(value) : Number(value ?? 0);
	return Number.isSafeInteger(count) && count >= 0 ? count : 1;
}

async function tableNames(client: Pick<Client, 'execute'>): Promise<Set<string>> {
	const result = await client.execute("SELECT name FROM sqlite_master WHERE type = 'table'");
	return new Set(
		result.rows
			.map((row) => rowValue(row, 'name', 0))
			.filter((name): name is string => typeof name === 'string')
	);
}

async function tableColumns(client: Pick<Client, 'execute'>, table: string): Promise<Set<string>> {
	const result = await client.execute(`PRAGMA table_info(${identifier(table)})`);
	return new Set(
		result.rows
			.map((row) => rowValue(row, 'name', 1))
			.filter((name): name is string => typeof name === 'string')
	);
}

/**
 * Detect orphaned and cross-server item/collection links without mutating the database.
 * This complements SQLite foreign keys, which validate parent identity but cannot prove
 * that a duplicated `server_instance_id` agrees with the referenced parent's owner.
 */
export async function inspectScopeIntegrity(
	client: Pick<Client, 'execute'>
): Promise<ScopeIntegrityResult> {
	const tables = await tableNames(client);
	const columns = new Map<string, Set<string>>();
	const getColumns = async (table: string) => {
		let value = columns.get(table);
		if (!value) {
			value = await tableColumns(client, table);
			columns.set(table, value);
		}
		return value;
	};

	const violations: ScopeIntegrityViolation[] = [];
	let checkedRelations = 0;
	for (const table of NAMESPACE_ROOTS) {
		if (!tables.has(table)) continue;
		const rootColumns = await getColumns(table);
		// Pre-0008 snapshots acquire their server namespace during forward migration.
		if (!rootColumns.has('server_instance_id')) continue;
		checkedRelations++;
		if (!tables.has('server_instances')) {
			violations.push({ relation: `${table}.server_instance_id`, rows: 1 });
			continue;
		}
		const serverColumns = await getColumns('server_instances');
		if (!serverColumns.has('id')) {
			violations.push({ relation: `${table}.server_instance_id`, rows: 1 });
			continue;
		}
		const result = await client.execute(`
			SELECT count(*) AS count
			FROM ${identifier(table)} AS root
			WHERE root."server_instance_id" IS NULL
				OR NOT EXISTS (
					SELECT 1
					FROM "server_instances" AS server
					WHERE server."id" = root."server_instance_id"
				)
		`);
		const count = countValue(rowValue(result.rows[0], 'count', 0));
		if (count > 0) violations.push({ relation: `${table}.server_instance_id`, rows: count });
	}

	for (const relation of SCOPE_RELATIONS) {
		if (!tables.has(relation.childTable)) continue;
		const childColumns = await getColumns(relation.childTable);
		// Pre-0008 snapshots do not carry a server namespace yet and are migrated forward.
		if (
			!childColumns.has('server_instance_id') ||
			!childColumns.has(relation.childReferenceColumn)
		) {
			continue;
		}

		checkedRelations++;
		if (!tables.has(relation.parentTable)) {
			violations.push({ relation: relation.name, rows: 1 });
			continue;
		}
		const parentColumns = await getColumns(relation.parentTable);
		if (!parentColumns.has('server_instance_id') || !parentColumns.has(relation.parentIdColumn)) {
			violations.push({ relation: relation.name, rows: 1 });
			continue;
		}

		const child = identifier(relation.childTable);
		const parent = identifier(relation.parentTable);
		const reference = identifier(relation.childReferenceColumn);
		const parentId = identifier(relation.parentIdColumn);
		const result = await client.execute(`
			SELECT count(*) AS count
			FROM ${child} AS child
			WHERE child.${reference} IS NOT NULL
				AND (
					child."server_instance_id" IS NULL
					OR NOT EXISTS (
						SELECT 1
						FROM ${parent} AS parent
						WHERE parent.${parentId} = child.${reference}
							AND parent."server_instance_id" = child."server_instance_id"
					)
				)
		`);
		const count = countValue(rowValue(result.rows[0], 'count', 0));
		if (count > 0) violations.push({ relation: relation.name, rows: count });
	}

	const violationCount = violations.reduce((total, entry) => total + entry.rows, 0);
	return { ok: violationCount === 0, violationCount, checkedRelations, violations };
}
