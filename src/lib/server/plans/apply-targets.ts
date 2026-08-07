import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from '$lib/server/db/schema';
import {
	MediaItemScopeMismatchError,
	requireScopedMediaItemsById
} from '$lib/server/media-items/scoped-query';
import { ApplyPlannerError, type ApplyItemRef } from './apply-planner';

type Database = LibSQLDatabase<typeof schema>;
type ReadExecutor = Pick<Database, 'select'>;

/** Materialize ids into explicit scoped planner refs without silently dropping rows. */
export async function resolveScopedApplyTargets(
	database: ReadExecutor,
	itemIds: number[],
	expectedServerInstanceId: string
): Promise<ApplyItemRef[]> {
	if (
		itemIds.length === 0 ||
		itemIds.some((id) => !Number.isInteger(id) || id <= 0) ||
		new Set(itemIds).size !== itemIds.length
	) {
		throw new ApplyPlannerError(
			'invalid_request',
			'Apply item ids must be unique positive integers'
		);
	}

	try {
		const rows = await requireScopedMediaItemsById(database, expectedServerInstanceId, itemIds);
		return rows.map((row) => ({
			serverInstanceId: row.serverInstanceId,
			mediaItemId: row.id
		}));
	} catch (error) {
		if (error instanceof MediaItemScopeMismatchError) {
			throw new ApplyPlannerError('scope_mismatch', 'Apply item does not belong to active scope');
		}
		throw error;
	}
}
