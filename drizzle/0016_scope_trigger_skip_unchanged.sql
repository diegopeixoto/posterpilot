-- The parent scope triggers fired on every UPDATE that merely *named* server_instance_id,
-- and a library sync re-writes each item's whole row (server_instance_id included) once
-- per item. Each firing ran thirteen `media_item_id = ? AND server_instance_id IS NOT ?`
-- probes that no index can serve (the scope indexes lead with server_instance_id), so
-- every probe scanned its whole child table: on one install ~100 ms per item, ~3,400
-- items per sync, all of it synchronous on the server's only thread. Children are kept
-- in scope by their own insert/update triggers, so the parent check only matters when
-- the value really changes; WHEN skips the probes otherwise.
DROP TRIGGER IF EXISTS `media_items_scope_update`;
--> statement-breakpoint
CREATE TRIGGER `media_items_scope_update`
BEFORE UPDATE OF `server_instance_id` ON `media_items`
WHEN OLD.`server_instance_id` IS NOT NEW.`server_instance_id`
BEGIN
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `poster_candidates`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `child_selections`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `applied_posters`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `job_item_outcomes`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `events`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `collection_memberships`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `artwork_slot_states`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `artwork_snapshots`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `artwork_revisions`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `provider_discovery_runs`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `provider_discovery_outcomes`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `review_events`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `resolution_audits`
		WHERE `media_item_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_items.server_instance_id') END;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `media_collections_scope_update`;
--> statement-breakpoint
CREATE TRIGGER `media_collections_scope_update`
BEFORE UPDATE OF `server_instance_id` ON `media_collections`
WHEN OLD.`server_instance_id` IS NOT NEW.`server_instance_id`
BEGIN
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `collection_memberships`
		WHERE `collection_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_collections.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `artwork_slot_states`
		WHERE `media_collection_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_collections.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `artwork_snapshots`
		WHERE `media_collection_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_collections.server_instance_id') END;
	SELECT CASE WHEN EXISTS (
		SELECT 1 FROM `artwork_revisions`
		WHERE `media_collection_id` = OLD.`id` AND `server_instance_id` IS NOT NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:media_collections.server_instance_id') END;
END;
