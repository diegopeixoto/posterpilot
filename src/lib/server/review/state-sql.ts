import { sql } from 'drizzle-orm';
import { mediaItems } from '$lib/server/db/schema';
import type { ReviewState } from './state';

const latestOutcomeJob = sql`(
	select max(latest_outcome.job_id)
	from job_item_outcomes latest_outcome
	where latest_outcome.media_item_id = ${mediaItems.id}
		and latest_outcome.server_instance_id = ${mediaItems.serverInstanceId}
)`;

/** SQL counterpart to deriveReviewState, kept free of the live DB for unit tests. */
export const reviewStateExpression = sql<ReviewState>`case
	when ${mediaItems.ignored} = 1 then 'ignored'
	when exists (
		select 1 from job_item_outcomes failed
		where failed.media_item_id = ${mediaItems.id}
			and failed.server_instance_id = ${mediaItems.serverInstanceId}
			and failed.job_id = ${latestOutcomeJob}
			and failed.status = 'failed'
			and exists (
				select 1 from job_item_outcomes succeeded
				where succeeded.job_id = failed.job_id
					and succeeded.media_item_id = failed.media_item_id
					and succeeded.status = 'success'
			)
	) then 'partial_failure'
	when ${mediaItems.externalArtworkChangedAt} is not null
		and (${mediaItems.lastVerifiedAt} is null or ${mediaItems.externalArtworkChangedAt} > ${mediaItems.lastVerifiedAt})
		then 'externally_changed'
	when ${mediaItems.selectedPosterUrl} is not null
		or ${mediaItems.selectedBackgroundUrl} is not null
		or exists (
			select 1 from child_selections staged_child
			where staged_child.media_item_id = ${mediaItems.id}
				and staged_child.server_instance_id = ${mediaItems.serverInstanceId}
		) then 'staged'
	when ${mediaItems.resolved} = 0 then 'unresolved'
	when ${mediaItems.reviewedAt} is not null then 'completed'
	when ${mediaItems.hasCandidates} = 1 then 'suggestion_ready'
	when ${mediaItems.discoveryStatus} in ('empty', 'succeeded') then 'no_candidates'
	else 'new'
end`;
