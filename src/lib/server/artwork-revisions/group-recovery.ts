/**
 * Boot-time reconciliation for revision groups interrupted by a restart.
 *
 * Request-scoped executions (undo, custom upload) create a `pending` group and
 * finalize it only after the whole operation loop completes. A crash or restart
 * mid-loop leaves that group `pending` forever: it has no job row, so durable
 * job recovery never touches it, and `finalizeGroup()` refuses groups with zero
 * or still-pending revisions. At boot no request can be in flight, so every
 * job-less `pending` group is necessarily interrupted — close it honestly from
 * the outcomes that were recorded before the interruption. Groups owned by
 * durable jobs (`jobId` set) are left to job recovery.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { LibSQLDatabase } from 'drizzle-orm/libsql';
import type * as schema from '$lib/server/db/schema';
import { artworkRevisionGroups, artworkRevisions } from '$lib/server/db/schema';

export interface InterruptedGroupRecovery {
	/** Groups closed by this pass. */
	recovered: number;
}

export async function recoverInterruptedRevisionGroups(
	database: LibSQLDatabase<typeof schema>,
	now = new Date()
): Promise<InterruptedGroupRecovery> {
	const orphaned = await database
		.select({ id: artworkRevisionGroups.id, summary: artworkRevisionGroups.summary })
		.from(artworkRevisionGroups)
		.where(and(eq(artworkRevisionGroups.outcome, 'pending'), isNull(artworkRevisionGroups.jobId)));

	for (const group of orphaned) {
		const rows = await database
			.select({ outcome: artworkRevisions.outcome })
			.from(artworkRevisions)
			.where(eq(artworkRevisions.groupId, group.id));
		const succeeded = rows.filter((row) => row.outcome === 'success').length;
		await database
			.update(artworkRevisionGroups)
			.set({
				// Any recorded success means work reached the server: `partial`, so the
				// history timeline still offers undo for what landed. Nothing recorded
				// (or only failures) means the interruption lost nothing: `failed`.
				outcome: succeeded > 0 ? 'partial' : 'failed',
				completedAt: now,
				summary: {
					...(group.summary ?? {}),
					interruptedByRestart: true,
					recordedOutcomes: rows.length
				}
			})
			.where(
				and(eq(artworkRevisionGroups.id, group.id), eq(artworkRevisionGroups.outcome, 'pending'))
			);
	}

	return { recovered: orphaned.length };
}
