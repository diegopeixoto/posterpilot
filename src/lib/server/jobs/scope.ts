import { eq, or, sql, type SQL } from 'drizzle-orm';
import { jobs } from '$lib/server/db/schema';

/**
 * Authorize a durable job against every media-server instance represented by its
 * immutable payload. The scalar column remains the fast path for single-server
 * work; multi-server apply rows deliberately store NULL there and are resolved
 * through their frozen target/source scope instead.
 */
export function jobServerScopeCondition(serverInstanceId: string): SQL {
	return or(
		eq(jobs.serverInstanceId, serverInstanceId),
		sql`exists (
			select 1
			from json_each(${jobs.payload}, '$.plan.scope.serverInstanceIds') as scoped_server
			where scoped_server.value = ${serverInstanceId}
		)`,
		sql`json_extract(${jobs.payload}, '$.plan.context.sourceItem.serverInstanceId') = ${serverInstanceId}`
	)!;
}
