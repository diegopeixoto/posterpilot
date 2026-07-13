CREATE TABLE `artwork_revision_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`server_instance_id` text NOT NULL,
	`operation_plan_id` text,
	`job_id` integer,
	`kind` text NOT NULL,
	`initiator` text NOT NULL,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`summary` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_plan_id`) REFERENCES `operation_plans`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `artwork_revision_groups_server_created_idx` ON `artwork_revision_groups` (`server_instance_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `artwork_revisions` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer,
	`media_collection_id` text,
	`operation_plan_id` text,
	`job_id` integer,
	`undo_of_revision_id` text,
	`before_snapshot_id` text,
	`after_snapshot_id` text,
	`candidate_id` integer,
	`action` text NOT NULL,
	`destination` text NOT NULL,
	`kind` text NOT NULL,
	`season` integer,
	`episode` integer,
	`apply_method` text,
	`source_provider` text,
	`provenance` text,
	`prior_fingerprint` text,
	`proposed_fingerprint` text,
	`outcome` text DEFAULT 'pending' NOT NULL,
	`verification` text DEFAULT 'pending' NOT NULL,
	`error_code` text,
	`error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `artwork_revision_groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_collection_id`) REFERENCES `media_collections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_plan_id`) REFERENCES `operation_plans`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`undo_of_revision_id`) REFERENCES `artwork_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`before_snapshot_id`) REFERENCES `artwork_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`after_snapshot_id`) REFERENCES `artwork_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`candidate_id`) REFERENCES `poster_candidates`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `artwork_revisions_item_timeline_idx` ON `artwork_revisions` (`server_instance_id`,`media_item_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `artwork_revisions_group_idx` ON `artwork_revisions` (`group_id`);--> statement-breakpoint
CREATE INDEX `artwork_revisions_undo_idx` ON `artwork_revisions` (`undo_of_revision_id`);--> statement-breakpoint
CREATE TABLE `artwork_slot_states` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer,
	`media_collection_id` text,
	`kind` text NOT NULL,
	`season` integer,
	`episode` integer,
	`current_url` text,
	`current_fingerprint` text,
	`artwork_version` integer DEFAULT 0 NOT NULL,
	`last_observed_at` integer,
	`last_verified_at` integer,
	`external_changed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_collection_id`) REFERENCES `media_collections`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_slot_states_item_root_unique` ON `artwork_slot_states` (`server_instance_id`,`media_item_id`,`kind`) WHERE "artwork_slot_states"."media_item_id" is not null and "artwork_slot_states"."media_collection_id" is null and "artwork_slot_states"."season" is null and "artwork_slot_states"."episode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_slot_states_item_season_unique` ON `artwork_slot_states` (`server_instance_id`,`media_item_id`,`kind`,`season`) WHERE "artwork_slot_states"."media_item_id" is not null and "artwork_slot_states"."media_collection_id" is null and "artwork_slot_states"."season" is not null and "artwork_slot_states"."episode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_slot_states_item_episode_unique` ON `artwork_slot_states` (`server_instance_id`,`media_item_id`,`kind`,`season`,`episode`) WHERE "artwork_slot_states"."media_item_id" is not null and "artwork_slot_states"."media_collection_id" is null and "artwork_slot_states"."episode" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_slot_states_collection_unique` ON `artwork_slot_states` (`server_instance_id`,`media_collection_id`,`kind`) WHERE "artwork_slot_states"."media_item_id" is null and "artwork_slot_states"."media_collection_id" is not null;--> statement-breakpoint
CREATE TABLE `artwork_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer,
	`media_collection_id` text,
	`destination` text NOT NULL,
	`kind` text NOT NULL,
	`season` integer,
	`episode` integer,
	`state` text NOT NULL,
	`sha256` text,
	`storage_path` text,
	`content_type` text,
	`size_bytes` integer,
	`value` text,
	`metadata` text,
	`is_original` integer DEFAULT false NOT NULL,
	`retained_until` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_collection_id`) REFERENCES `media_collections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `artwork_snapshots_sha_idx` ON `artwork_snapshots` (`sha256`);--> statement-breakpoint
CREATE INDEX `artwork_snapshots_server_item_idx` ON `artwork_snapshots` (`server_instance_id`,`media_item_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_snapshots_original_item_root_unique` ON `artwork_snapshots` (`server_instance_id`,`media_item_id`,`destination`,`kind`) WHERE "artwork_snapshots"."is_original" = 1 and "artwork_snapshots"."media_item_id" is not null and "artwork_snapshots"."media_collection_id" is null and "artwork_snapshots"."season" is null and "artwork_snapshots"."episode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_snapshots_original_item_season_unique` ON `artwork_snapshots` (`server_instance_id`,`media_item_id`,`destination`,`kind`,`season`) WHERE "artwork_snapshots"."is_original" = 1 and "artwork_snapshots"."media_item_id" is not null and "artwork_snapshots"."media_collection_id" is null and "artwork_snapshots"."season" is not null and "artwork_snapshots"."episode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_snapshots_original_item_episode_unique` ON `artwork_snapshots` (`server_instance_id`,`media_item_id`,`destination`,`kind`,`season`,`episode`) WHERE "artwork_snapshots"."is_original" = 1 and "artwork_snapshots"."media_item_id" is not null and "artwork_snapshots"."media_collection_id" is null and "artwork_snapshots"."episode" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_snapshots_original_collection_unique` ON `artwork_snapshots` (`server_instance_id`,`media_collection_id`,`destination`,`kind`) WHERE "artwork_snapshots"."is_original" = 1 and "artwork_snapshots"."media_item_id" is null and "artwork_snapshots"."media_collection_id" is not null;--> statement-breakpoint
CREATE TABLE `automation_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`schedule_id` text NOT NULL,
	`server_instance_id` text NOT NULL,
	`logical_key` text NOT NULL,
	`trigger_type` text NOT NULL,
	`event_identity` text,
	`scheduled_for` integer NOT NULL,
	`job_id` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`error_code` text,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`schedule_id`) REFERENCES `automation_schedules`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_occurrences_schedule_logical_unique` ON `automation_occurrences` (`schedule_id`,`logical_key`);--> statement-breakpoint
CREATE INDEX `automation_occurrences_server_created_idx` ON `automation_occurrences` (`server_instance_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `automation_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`server_instance_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`trigger_type` text NOT NULL,
	`action` text DEFAULT 'sync_discover' NOT NULL,
	`timezone` text NOT NULL,
	`interval_minutes` integer,
	`local_time` text,
	`event_type` text,
	`library_scopes` text NOT NULL,
	`discovery_inputs` text,
	`review_view_id` text,
	`retry_policy` text,
	`failure_pause_threshold` integer DEFAULT 3 NOT NULL,
	`consecutive_failures` integer DEFAULT 0 NOT NULL,
	`catch_up_window_minutes` integer DEFAULT 60 NOT NULL,
	`webhook_token_hash` text,
	`last_run_at` integer,
	`last_success_at` integer,
	`next_run_at` integer,
	`paused_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`review_view_id`) REFERENCES `review_views`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `automation_schedules_server_name_unique` ON `automation_schedules` (`server_instance_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `automation_schedules_due_idx` ON `automation_schedules` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE TABLE `backup_records` (
	`id` text PRIMARY KEY NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'creating' NOT NULL,
	`bundle_name` text NOT NULL,
	`storage_path` text NOT NULL,
	`manifest` text,
	`app_version` text,
	`schema_version` text,
	`key_mode` text,
	`key_fingerprint` text,
	`size_bytes` integer,
	`checksum` text,
	`protected` integer DEFAULT false NOT NULL,
	`validation_status` text DEFAULT 'unknown' NOT NULL,
	`error_code` text,
	`error` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	`validated_at` integer,
	`deleted_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `backup_records_bundle_name_unique` ON `backup_records` (`bundle_name`);--> statement-breakpoint
CREATE INDEX `backup_records_created_idx` ON `backup_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `collection_memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`collection_id` text NOT NULL,
	`media_item_id` integer,
	`source` text NOT NULL,
	`source_member_id` text NOT NULL,
	`title` text,
	`year` integer,
	`available_locally` integer DEFAULT true NOT NULL,
	`provenance` text,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`removed_at` integer,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`collection_id`) REFERENCES `media_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `collection_memberships_source_member_unique` ON `collection_memberships` (`server_instance_id`,`collection_id`,`source`,`source_member_id`);--> statement-breakpoint
CREATE INDEX `collection_memberships_item_idx` ON `collection_memberships` (`server_instance_id`,`media_item_id`);--> statement-breakpoint
CREATE TABLE `diagnostic_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`server_instance_id` text,
	`component_type` text NOT NULL,
	`component_key` text NOT NULL,
	`status` text NOT NULL,
	`credential_status` text,
	`latency_ms` integer,
	`last_success_at` integer,
	`capabilities` text,
	`path_checks` text,
	`error_code` text,
	`error` text,
	`checked_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `diagnostic_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `diagnostic_results_component_idx` ON `diagnostic_results` (`component_type`,`component_key`,`checked_at`);--> statement-breakpoint
CREATE TABLE `diagnostic_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`server_instance_id` text,
	`job_id` integer,
	`status` text DEFAULT 'running' NOT NULL,
	`initiator` text DEFAULT 'user' NOT NULL,
	`summary` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `diagnostic_runs_server_started_idx` ON `diagnostic_runs` (`server_instance_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `job_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`server_instance_id` text,
	`attempt_number` integer NOT NULL,
	`trigger` text NOT NULL,
	`status` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`result` text,
	`retryable` integer,
	`error_code` text,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `job_attempts_job_number_unique` ON `job_attempts` (`job_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `job_attempts_server_idx` ON `job_attempts` (`server_instance_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `job_item_outcomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`attempt_id` integer,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer,
	`destination` text,
	`kind` text,
	`season` integer,
	`episode` integer,
	`status` text NOT NULL,
	`retryable` integer DEFAULT false NOT NULL,
	`result` text,
	`error_code` text,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`attempt_id`) REFERENCES `job_attempts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `job_item_outcomes_retry_idx` ON `job_item_outcomes` (`job_id`,`status`,`retryable`);--> statement-breakpoint
CREATE INDEX `job_item_outcomes_server_item_idx` ON `job_item_outcomes` (`server_instance_id`,`media_item_id`);--> statement-breakpoint
CREATE TABLE `media_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`server_instance_id` text NOT NULL,
	`source` text NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`native_provider` text,
	`current_poster_url` text,
	`current_background_url` text,
	`capabilities` text,
	`metadata` text,
	`first_seen_at` integer NOT NULL,
	`last_synced_at` integer,
	`removed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `media_collections_server_source_unique` ON `media_collections` (`server_instance_id`,`source`,`source_id`);--> statement-breakpoint
CREATE INDEX `media_collections_server_name_idx` ON `media_collections` (`server_instance_id`,`name`);--> statement-breakpoint
CREATE TABLE `operation_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`server_instance_id` text,
	`library_section_key` text,
	`payload` text NOT NULL,
	`digest` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `operation_plans_scope_expiry_idx` ON `operation_plans` (`kind`,`server_instance_id`,`expires_at`);--> statement-breakpoint
CREATE INDEX `operation_plans_digest_idx` ON `operation_plans` (`digest`);--> statement-breakpoint
CREATE TABLE `provider_discovery_outcomes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`provider` text NOT NULL,
	`status` text NOT NULL,
	`candidate_count` integer DEFAULT 0 NOT NULL,
	`retained_stale_candidates` integer DEFAULT false NOT NULL,
	`latency_ms` integer,
	`error_code` text,
	`error` text,
	`last_success_at` integer,
	`started_at` integer,
	`completed_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `provider_discovery_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_discovery_outcomes_run_provider_unique` ON `provider_discovery_outcomes` (`run_id`,`provider`);--> statement-breakpoint
CREATE INDEX `provider_discovery_outcomes_item_idx` ON `provider_discovery_outcomes` (`server_instance_id`,`media_item_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `provider_discovery_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`job_id` integer,
	`tmdb_id` text,
	`media_type` text,
	`status` text DEFAULT 'running' NOT NULL,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `provider_discovery_runs_item_idx` ON `provider_discovery_runs` (`server_instance_id`,`media_item_id`,`started_at`);--> statement-breakpoint
CREATE TABLE `provider_status` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text,
	`component_type` text NOT NULL,
	`component_key` text NOT NULL,
	`status` text DEFAULT 'unknown' NOT NULL,
	`credential_status` text DEFAULT 'unknown' NOT NULL,
	`latency_ms` integer,
	`last_attempt_at` integer,
	`last_success_at` integer,
	`last_error_at` integer,
	`error_code` text,
	`error` text,
	`capabilities` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_status_server_component_unique` ON `provider_status` (`server_instance_id`,`component_type`,`component_key`) WHERE "provider_status"."server_instance_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `provider_status_global_component_unique` ON `provider_status` (`component_type`,`component_key`) WHERE "provider_status"."server_instance_id" is null;--> statement-breakpoint
CREATE TABLE `resolution_audits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`action` text NOT NULL,
	`previous_tmdb_id` text,
	`previous_media_type` text,
	`resulting_tmdb_id` text,
	`resulting_media_type` text,
	`reason` text NOT NULL,
	`source` text,
	`user_confirmed` integer DEFAULT false NOT NULL,
	`attempted_sources` text,
	`details` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `resolution_audits_item_timeline_idx` ON `resolution_audits` (`server_instance_id`,`media_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `restore_records` (
	`id` text PRIMARY KEY NOT NULL,
	`backup_id` text NOT NULL,
	`safety_backup_id` text,
	`operation_plan_id` text,
	`status` text NOT NULL,
	`preview_checksum` text NOT NULL,
	`report` text,
	`error_code` text,
	`error` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	FOREIGN KEY (`backup_id`) REFERENCES `backup_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`safety_backup_id`) REFERENCES `backup_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`operation_plan_id`) REFERENCES `operation_plans`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `restore_records_created_idx` ON `restore_records` (`created_at`);--> statement-breakpoint
CREATE TABLE `review_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`action` text NOT NULL,
	`from_state` text,
	`to_state` text,
	`context` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `review_events_item_timeline_idx` ON `review_events` (`server_instance_id`,`media_item_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `review_views` (
	`id` text PRIMARY KEY NOT NULL,
	`server_instance_id` text NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`library_section_key` text,
	`filters` text NOT NULL,
	`sort` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_views_server_name_unique` ON `review_views` (`server_instance_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `review_views_server_library_idx` ON `review_views` (`server_instance_id`,`library_section_key`);--> statement-breakpoint
CREATE TABLE `server_instances` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`type` text NOT NULL,
	`base_url` text,
	`credential` text,
	`connection_settings` text,
	`capabilities` text,
	`enabled` integer DEFAULT true NOT NULL,
	`protected` integer DEFAULT false NOT NULL,
	`connection_status` text DEFAULT 'unknown' NOT NULL,
	`last_tested_at` integer,
	`disconnected_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `server_instances_active_name_unique` ON `server_instances` (`normalized_name`) WHERE "server_instances"."enabled" = 1 and "server_instances"."disconnected_at" is null;--> statement-breakpoint
CREATE INDEX `server_instances_enabled_idx` ON `server_instances` (`enabled`);--> statement-breakpoint
-- Materialize one deterministic scope only when legacy server-owned state or persisted
-- connection data exists. Environment-only credentials are attached by the idempotent
-- startup materializer; the placeholder preserves existing rows in the meantime.
INSERT OR IGNORE INTO `server_instances` (
	`id`, `name`, `normalized_name`, `type`, `base_url`, `credential`, `enabled`, `protected`,
	`connection_status`, `created_at`, `updated_at`
)
SELECT
	'legacy-default',
	'Default server',
	'default server',
	CASE lower(coalesce((SELECT `value` FROM `settings` WHERE `key` = 'serverType'), 'plex'))
		WHEN 'jellyfin' THEN 'jellyfin'
		WHEN 'emby' THEN 'emby'
		ELSE 'plex'
	END,
	CASE lower(coalesce((SELECT `value` FROM `settings` WHERE `key` = 'serverType'), 'plex'))
		WHEN 'jellyfin' THEN (SELECT `value` FROM `settings` WHERE `key` = 'jellyfinUrl')
		WHEN 'emby' THEN (SELECT `value` FROM `settings` WHERE `key` = 'embyUrl')
		ELSE (SELECT `value` FROM `settings` WHERE `key` = 'plexUrl')
	END,
	CASE lower(coalesce((SELECT `value` FROM `settings` WHERE `key` = 'serverType'), 'plex'))
		WHEN 'jellyfin' THEN (SELECT `value` FROM `settings` WHERE `key` = 'jellyfinApiKey')
		WHEN 'emby' THEN (SELECT `value` FROM `settings` WHERE `key` = 'embyApiKey')
		ELSE (SELECT `value` FROM `settings` WHERE `key` = 'plexToken')
	END,
	1,
	1,
	'unknown',
	cast(strftime('%s', 'now') as integer),
	cast(strftime('%s', 'now') as integer)
WHERE
	EXISTS (SELECT 1 FROM `media_items` LIMIT 1)
	OR EXISTS (SELECT 1 FROM `jobs` LIMIT 1)
	OR EXISTS (SELECT 1 FROM `applied_posters` LIMIT 1)
	OR EXISTS (
		SELECT 1 FROM `settings`
		WHERE `key` IN ('plexUrl', 'plexToken', 'jellyfinUrl', 'jellyfinApiKey', 'embyUrl', 'embyApiKey')
		AND length(trim(`value`)) > 0
		LIMIT 1
	);--> statement-breakpoint
INSERT OR IGNORE INTO `settings` (`key`, `value`)
SELECT 'activeServerInstanceId', 'legacy-default'
WHERE EXISTS (SELECT 1 FROM `server_instances` WHERE `id` = 'legacy-default');--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_media_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`rating_key` text NOT NULL,
	`section_key` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`year` integer,
	`tmdb_id` text,
	`imdb_id` text,
	`tvdb_id` text,
	`media_type` text,
	`resolution_reason` text,
	`manual_match_pinned` integer DEFAULT false NOT NULL,
	`resolution_updated_at` integer,
	`current_poster_url` text,
	`current_background_url` text,
	`current_poster_fingerprint` text,
	`current_background_fingerprint` text,
	`artwork_version` integer DEFAULT 0 NOT NULL,
	`selected_poster_url` text,
	`selected_background_url` text,
	`selected_poster_candidate_id` integer,
	`selected_background_candidate_id` integer,
	`selection_updated_at` integer,
	`overview` text,
	`tagline` text,
	`genres` text,
	`runtime` integer,
	`rating` real,
	`backdrop_url` text,
	`logo_url` text,
	`season_count` integer,
	`episode_count` integer,
	`cast` text,
	`tmdb_collection_id` text,
	`tmdb_collection_name` text,
	`has_candidates` integer DEFAULT false NOT NULL,
	`has_mediux` integer DEFAULT false NOT NULL,
	`resolved` integer DEFAULT false NOT NULL,
	`ignored` integer DEFAULT false NOT NULL,
	`reviewed_at` integer,
	`discovery_status` text DEFAULT 'not_started' NOT NULL,
	`discovery_started_at` integer,
	`discovery_completed_at` integer,
	`external_artwork_changed_at` integer,
	`last_verified_at` integer,
	`server_updated_at` integer,
	`added_at` integer,
	`watched` integer DEFAULT false NOT NULL,
	`last_synced_at` integer,
	`source_removed_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_media_items` (
	`id`, `server_instance_id`, `rating_key`, `section_key`, `type`, `title`, `year`,
	`tmdb_id`, `imdb_id`, `tvdb_id`, `media_type`, `resolution_reason`,
	`manual_match_pinned`, `resolution_updated_at`, `current_poster_url`,
	`current_background_url`, `current_poster_fingerprint`, `current_background_fingerprint`,
	`artwork_version`, `selected_poster_url`, `selected_background_url`,
	`selected_poster_candidate_id`, `selected_background_candidate_id`, `selection_updated_at`,
	`overview`, `tagline`, `genres`, `runtime`, `rating`, `backdrop_url`, `logo_url`,
	`season_count`, `episode_count`, `cast`, `tmdb_collection_id`, `tmdb_collection_name`,
	`has_candidates`, `has_mediux`, `resolved`, `ignored`, `reviewed_at`, `discovery_status`,
	`discovery_started_at`, `discovery_completed_at`, `external_artwork_changed_at`,
	`last_verified_at`, `server_updated_at`, `added_at`, `watched`, `last_synced_at`,
	`source_removed_at`, `updated_at`
)
SELECT
	m.`id`,
	'legacy-default',
	m.`rating_key`,
	m.`section_key`,
	m.`type`,
	m.`title`,
	m.`year`,
	m.`tmdb_id`,
	m.`imdb_id`,
	m.`tvdb_id`,
	m.`media_type`,
	CASE WHEN m.`resolved` = 1 THEN 'legacy' ELSE NULL END,
	0,
	NULL,
	m.`current_poster_url`,
	NULL,
	NULL,
	NULL,
	0,
	m.`selected_poster_url`,
	m.`selected_background_url`,
	NULL,
	NULL,
	NULL,
	m.`overview`,
	m.`tagline`,
	m.`genres`,
	m.`runtime`,
	m.`rating`,
	m.`backdrop_url`,
	m.`logo_url`,
	m.`season_count`,
	m.`episode_count`,
	m.`cast`,
	NULL,
	NULL,
	CASE WHEN EXISTS (
		SELECT 1 FROM `poster_candidates` c WHERE c.`media_item_id` = m.`id`
	) THEN 1 ELSE 0 END,
	CASE WHEN EXISTS (
		SELECT 1 FROM `poster_candidates` c
		WHERE c.`media_item_id` = m.`id` AND c.`provider` = 'mediux'
	) THEN 1 ELSE 0 END,
	m.`resolved`,
	m.`ignored`,
	CASE
		WHEN m.`ignored` = 1 THEN m.`updated_at`
		WHEN EXISTS (SELECT 1 FROM `applied_posters` a WHERE a.`media_item_id` = m.`id`)
			THEN (SELECT max(a.`applied_at`) FROM `applied_posters` a WHERE a.`media_item_id` = m.`id`)
		ELSE NULL
	END,
	CASE
		WHEN EXISTS (SELECT 1 FROM `poster_candidates` c WHERE c.`media_item_id` = m.`id`)
			THEN 'succeeded'
		WHEN m.`has_mediux` = 0 THEN 'empty'
		ELSE 'not_started'
	END,
	NULL,
	CASE
		WHEN EXISTS (SELECT 1 FROM `poster_candidates` c WHERE c.`media_item_id` = m.`id`)
			THEN (SELECT max(c.`created_at`) FROM `poster_candidates` c WHERE c.`media_item_id` = m.`id`)
		WHEN m.`has_mediux` = 0 THEN m.`updated_at`
		ELSE NULL
	END,
	NULL,
	NULL,
	m.`server_updated_at`,
	m.`added_at`,
	m.`watched`,
	m.`last_synced_at`,
	NULL,
	m.`updated_at`
FROM `media_items` m;--> statement-breakpoint
DROP TABLE `media_items`;--> statement-breakpoint
ALTER TABLE `__new_media_items` RENAME TO `media_items`;--> statement-breakpoint
CREATE UNIQUE INDEX `media_items_server_rating_key_unique` ON `media_items` (`server_instance_id`,`rating_key`);--> statement-breakpoint
CREATE INDEX `media_items_server_section_idx` ON `media_items` (`server_instance_id`,`section_key`);--> statement-breakpoint
CREATE INDEX `media_items_server_review_idx` ON `media_items` (`server_instance_id`,`ignored`,`reviewed_at`,`discovery_status`);--> statement-breakpoint
DROP INDEX `child_selections_season_slot`;--> statement-breakpoint
DROP INDEX `child_selections_episode_slot`;--> statement-breakpoint
CREATE TABLE `__new_child_selections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`kind` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer,
	`url` text NOT NULL,
	`candidate_id` integer,
	`provider` text,
	`set_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `poster_candidates`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_child_selections` (
	`id`, `server_instance_id`, `media_item_id`, `kind`, `season`, `episode`, `url`,
	`candidate_id`, `provider`, `set_id`, `updated_at`
)
SELECT
	c.`id`,
	(SELECT m.`server_instance_id` FROM `media_items` m WHERE m.`id` = c.`media_item_id`),
	c.`media_item_id`, c.`kind`, c.`season`, c.`episode`,
	c.`url`, NULL, NULL, NULL, c.`updated_at`
FROM `child_selections` c;--> statement-breakpoint
DROP TABLE `child_selections`;--> statement-breakpoint
ALTER TABLE `__new_child_selections` RENAME TO `child_selections`;--> statement-breakpoint
CREATE UNIQUE INDEX `child_selections_season_slot` ON `child_selections` (`server_instance_id`,`media_item_id`,`kind`,`season`) WHERE "child_selections"."episode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `child_selections_episode_slot` ON `child_selections` (`server_instance_id`,`media_item_id`,`kind`,`season`,`episode`) WHERE "child_selections"."episode" is not null;--> statement-breakpoint
CREATE TABLE `__new_applied_posters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`revision_group_id` text,
	`revision_id` text,
	`candidate_id` integer,
	`url` text NOT NULL,
	`method` text NOT NULL,
	`destination` text,
	`status` text NOT NULL,
	`verification` text,
	`source_provider` text,
	`content_hash` text,
	`error_code` text,
	`error` text,
	`kind` text,
	`season` integer,
	`episode` integer,
	`applied_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`candidate_id`) REFERENCES `poster_candidates`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_applied_posters` (
	`id`, `server_instance_id`, `media_item_id`, `revision_group_id`, `revision_id`,
	`candidate_id`, `url`, `method`, `destination`, `status`, `verification`,
	`source_provider`, `content_hash`, `error_code`, `error`, `kind`, `season`, `episode`,
	`applied_at`
)
SELECT
	a.`id`,
	(SELECT m.`server_instance_id` FROM `media_items` m WHERE m.`id` = a.`media_item_id`),
	a.`media_item_id`, NULL, NULL, NULL, a.`url`, a.`method`,
	CASE WHEN a.`method` = 'kometa' THEN 'kometa' ELSE 'server' END,
	a.`status`,
	CASE WHEN a.`status` = 'success' THEN 'unavailable' ELSE 'failed' END,
	NULL, NULL, NULL, a.`error`, a.`kind`, a.`season`, a.`episode`, a.`applied_at`
FROM `applied_posters` a;--> statement-breakpoint
DROP TABLE `applied_posters`;--> statement-breakpoint
ALTER TABLE `__new_applied_posters` RENAME TO `applied_posters`;--> statement-breakpoint
CREATE INDEX `applied_posters_server_item_idx` ON `applied_posters` (`server_instance_id`,`media_item_id`);--> statement-breakpoint
ALTER TABLE `events` ADD `server_instance_id` text REFERENCES server_instances(id);--> statement-breakpoint
ALTER TABLE `events` ADD `job_id` integer REFERENCES jobs(id);--> statement-breakpoint
ALTER TABLE `events` ADD `media_item_id` integer REFERENCES media_items(id);--> statement-breakpoint
ALTER TABLE `events` ADD `code` text;--> statement-breakpoint
ALTER TABLE `events` ADD `parameters` text;--> statement-breakpoint
ALTER TABLE `events` ADD `correlation_id` text;--> statement-breakpoint
UPDATE `events`
SET `server_instance_id` = 'legacy-default'
WHERE EXISTS (SELECT 1 FROM `server_instances` WHERE `id` = 'legacy-default');--> statement-breakpoint
CREATE INDEX `events_server_created_idx` ON `events` (`server_instance_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_job_idx` ON `events` (`job_id`);--> statement-breakpoint
CREATE TABLE `__new_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text,
	`library_section_key` text,
	`plan_id` text,
	`parent_job_id` integer,
	`type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`phase` text,
	`payload` text DEFAULT '{}' NOT NULL,
	`result` text,
	`initiator` text DEFAULT 'user' NOT NULL,
	`idempotency_key` text,
	`dedupe_key` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`available_at` integer,
	`lease_owner` text,
	`lease_expires_at` integer,
	`processed` integer DEFAULT 0 NOT NULL,
	`total` integer DEFAULT 0 NOT NULL,
	`current_item` text,
	`error_code` text,
	`error` text,
	`cancel_requested_at` integer,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`plan_id`) REFERENCES `operation_plans`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE set null
);--> statement-breakpoint
INSERT INTO `__new_jobs` (
	`id`, `server_instance_id`, `library_section_key`, `plan_id`, `parent_job_id`, `type`,
	`status`, `phase`, `payload`, `result`, `initiator`, `idempotency_key`, `dedupe_key`,
	`attempt`, `max_attempts`, `available_at`, `lease_owner`, `lease_expires_at`,
	`processed`, `total`, `current_item`, `error_code`, `error`, `cancel_requested_at`,
	`created_at`, `started_at`, `finished_at`, `updated_at`
)
SELECT
	j.`id`,
	CASE WHEN EXISTS (SELECT 1 FROM `server_instances` WHERE `id` = 'legacy-default')
		THEN 'legacy-default' ELSE NULL END,
	NULL, NULL, NULL, j.`type`, j.`status`, NULL, '{}', NULL, 'legacy', NULL, NULL,
	CASE WHEN j.`started_at` IS NULL THEN 0 ELSE 1 END,
	3,
	CASE WHEN j.`status` = 'pending'
		THEN coalesce(j.`started_at`, cast(strftime('%s', 'now') as integer))
		ELSE NULL END,
	NULL, NULL, j.`processed`, j.`total`, j.`current_item`, NULL, j.`error`, NULL,
	coalesce(j.`started_at`, j.`finished_at`, cast(strftime('%s', 'now') as integer)),
	j.`started_at`,
	j.`finished_at`,
	coalesce(j.`finished_at`, j.`started_at`, cast(strftime('%s', 'now') as integer))
FROM `jobs` j;--> statement-breakpoint
DROP TABLE `jobs`;--> statement-breakpoint
ALTER TABLE `__new_jobs` RENAME TO `jobs`;--> statement-breakpoint
CREATE INDEX `jobs_scope_status_idx` ON `jobs` (`server_instance_id`,`library_section_key`,`status`);--> statement-breakpoint
CREATE INDEX `jobs_available_idx` ON `jobs` (`status`,`available_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_active_dedupe_unique` ON `jobs` (`dedupe_key`) WHERE "jobs"."dedupe_key" is not null and "jobs"."status" in ('pending', 'running', 'retry_scheduled');--> statement-breakpoint
CREATE INDEX `jobs_idempotency_idx` ON `jobs` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `__new_poster_candidates` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`discovery_run_id` text,
	`provider_outcome_id` integer,
	`set_id` text NOT NULL,
	`provider` text DEFAULT 'mediux' NOT NULL,
	`provider_asset_id` text,
	`set_author` text,
	`design_family` text,
	`language` text,
	`url` text NOT NULL,
	`kind` text NOT NULL,
	`season` integer,
	`episode` integer,
	`resolved_tmdb_id` text,
	`resolved_media_type` text,
	`width` integer,
	`height` integer,
	`score` real,
	`active` integer DEFAULT true NOT NULL,
	`stale` integer DEFAULT false NOT NULL,
	`last_seen_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);--> statement-breakpoint
INSERT INTO `__new_poster_candidates` (
	`id`, `server_instance_id`, `media_item_id`, `discovery_run_id`, `provider_outcome_id`,
	`set_id`, `provider`, `provider_asset_id`, `set_author`, `design_family`, `language`,
	`url`, `kind`, `season`, `episode`, `resolved_tmdb_id`, `resolved_media_type`, `width`,
	`height`, `score`, `active`, `stale`, `last_seen_at`, `created_at`
)
SELECT
	c.`id`,
	(SELECT m.`server_instance_id` FROM `media_items` m WHERE m.`id` = c.`media_item_id`),
	c.`media_item_id`, NULL, NULL, c.`set_id`, c.`provider`,
	NULL, c.`set_author`, NULL, NULL, c.`url`, c.`kind`, c.`season`, c.`episode`,
	(SELECT m.`tmdb_id` FROM `media_items` m WHERE m.`id` = c.`media_item_id`),
	(SELECT m.`media_type` FROM `media_items` m WHERE m.`id` = c.`media_item_id`),
	c.`width`, c.`height`, c.`score`, 1, 0, c.`created_at`,
	c.`created_at`
FROM `poster_candidates` c;--> statement-breakpoint
DROP TABLE `poster_candidates`;--> statement-breakpoint
ALTER TABLE `__new_poster_candidates` RENAME TO `poster_candidates`;--> statement-breakpoint
CREATE INDEX `poster_candidates_server_item_idx` ON `poster_candidates` (`server_instance_id`,`media_item_id`);--> statement-breakpoint
CREATE INDEX `poster_candidates_provider_active_idx` ON `poster_candidates` (`server_instance_id`,`media_item_id`,`provider`,`active`);--> statement-breakpoint

-- Cached and preview payloads may contain credential-bearing URLs from older builds.
-- They are disposable and must not survive the migration into the hardened model.
DELETE FROM `http_cache`;--> statement-breakpoint
DELETE FROM `thumbnail_cache`;--> statement-breakpoint
UPDATE `artwork_revision_groups` SET `operation_plan_id` = NULL WHERE `operation_plan_id` IS NOT NULL;--> statement-breakpoint
UPDATE `artwork_revisions` SET `operation_plan_id` = NULL WHERE `operation_plan_id` IS NOT NULL;--> statement-breakpoint
UPDATE `restore_records` SET `operation_plan_id` = NULL WHERE `operation_plan_id` IS NOT NULL;--> statement-breakpoint
UPDATE `jobs` SET `plan_id` = NULL WHERE `plan_id` IS NOT NULL;--> statement-breakpoint
DELETE FROM `operation_plans`;--> statement-breakpoint
UPDATE `media_items`
SET
	`current_poster_url` = CASE
		WHEN lower(coalesce(`current_poster_url`, '')) GLOB '*token[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*api_key[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*api-key[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*apikey[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*credential[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*signature[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*authorization[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*password[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*secret[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*auth[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*://*:*@*'
		THEN NULL ELSE `current_poster_url` END,
	`current_background_url` = CASE
		WHEN lower(coalesce(`current_background_url`, '')) GLOB '*token[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*api_key[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*api-key[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*apikey[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*credential[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*signature[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*authorization[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*password[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*secret[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*auth[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*://*:*@*'
		THEN NULL ELSE `current_background_url` END;--> statement-breakpoint
UPDATE `artwork_slot_states`
SET `current_url` = NULL
WHERE lower(coalesce(`current_url`, '')) GLOB '*token[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*api_key[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*api-key[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*apikey[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*credential[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*signature[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*authorization[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*password[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*secret[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*auth[=%]*'
	OR lower(coalesce(`current_url`, '')) GLOB '*://*:*@*';--> statement-breakpoint
UPDATE `media_collections`
SET
	`current_poster_url` = CASE
		WHEN lower(coalesce(`current_poster_url`, '')) GLOB '*token[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*api_key[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*api-key[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*apikey[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*credential[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*signature[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*authorization[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*password[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*secret[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*auth[=%]*'
			OR lower(coalesce(`current_poster_url`, '')) GLOB '*://*:*@*'
		THEN NULL ELSE `current_poster_url` END,
	`current_background_url` = CASE
		WHEN lower(coalesce(`current_background_url`, '')) GLOB '*token[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*api_key[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*api-key[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*apikey[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*credential[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*signature[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*authorization[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*password[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*secret[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*auth[=%]*'
			OR lower(coalesce(`current_background_url`, '')) GLOB '*://*:*@*'
		THEN NULL ELSE `current_background_url` END;--> statement-breakpoint

-- SQLite foreign keys protect parent identity, but not agreement between the
-- duplicated server namespace and the referenced item/collection owner.
CREATE TRIGGER `poster_candidates_scope_insert`
BEFORE INSERT ON `poster_candidates`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:poster_candidates.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `poster_candidates_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `poster_candidates`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:poster_candidates.media_item_id');
END;--> statement-breakpoint

CREATE TRIGGER `child_selections_scope_insert`
BEFORE INSERT ON `child_selections`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:child_selections.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `child_selections_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `child_selections`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:child_selections.media_item_id');
END;--> statement-breakpoint

CREATE TRIGGER `applied_posters_scope_insert`
BEFORE INSERT ON `applied_posters`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:applied_posters.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `applied_posters_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `applied_posters`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:applied_posters.media_item_id');
END;--> statement-breakpoint

CREATE TRIGGER `job_item_outcomes_scope_insert`
BEFORE INSERT ON `job_item_outcomes`
WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:job_item_outcomes.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `job_item_outcomes_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `job_item_outcomes`
WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:job_item_outcomes.media_item_id');
END;--> statement-breakpoint

CREATE TRIGGER `events_scope_insert`
BEFORE INSERT ON `events`
WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:events.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `events_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `events`
WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:events.media_item_id');
END;--> statement-breakpoint

CREATE TRIGGER `collection_memberships_scope_insert`
BEFORE INSERT ON `collection_memberships`
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `media_collections`
		WHERE `id` = NEW.`collection_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:collection_memberships.collection_id') END;
	SELECT CASE WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_items`
		WHERE `id` = NEW.`media_item_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:collection_memberships.media_item_id') END;
END;--> statement-breakpoint
CREATE TRIGGER `collection_memberships_scope_update`
BEFORE UPDATE OF `server_instance_id`, `collection_id`, `media_item_id` ON `collection_memberships`
BEGIN
	SELECT CASE WHEN NOT EXISTS (
		SELECT 1 FROM `media_collections`
		WHERE `id` = NEW.`collection_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:collection_memberships.collection_id') END;
	SELECT CASE WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_items`
		WHERE `id` = NEW.`media_item_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:collection_memberships.media_item_id') END;
END;--> statement-breakpoint

CREATE TRIGGER `artwork_slot_states_scope_insert`
BEFORE INSERT ON `artwork_slot_states`
BEGIN
	SELECT CASE WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_items`
		WHERE `id` = NEW.`media_item_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_slot_states.media_item_id') END;
	SELECT CASE WHEN NEW.`media_collection_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_collections`
		WHERE `id` = NEW.`media_collection_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_slot_states.media_collection_id') END;
END;--> statement-breakpoint
CREATE TRIGGER `artwork_slot_states_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id`, `media_collection_id` ON `artwork_slot_states`
BEGIN
	SELECT CASE WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_items`
		WHERE `id` = NEW.`media_item_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_slot_states.media_item_id') END;
	SELECT CASE WHEN NEW.`media_collection_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_collections`
		WHERE `id` = NEW.`media_collection_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_slot_states.media_collection_id') END;
END;--> statement-breakpoint

CREATE TRIGGER `artwork_snapshots_scope_insert`
BEFORE INSERT ON `artwork_snapshots`
BEGIN
	SELECT CASE WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_items`
		WHERE `id` = NEW.`media_item_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_snapshots.media_item_id') END;
	SELECT CASE WHEN NEW.`media_collection_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_collections`
		WHERE `id` = NEW.`media_collection_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_snapshots.media_collection_id') END;
END;--> statement-breakpoint
CREATE TRIGGER `artwork_snapshots_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id`, `media_collection_id` ON `artwork_snapshots`
BEGIN
	SELECT CASE WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_items`
		WHERE `id` = NEW.`media_item_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_snapshots.media_item_id') END;
	SELECT CASE WHEN NEW.`media_collection_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_collections`
		WHERE `id` = NEW.`media_collection_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_snapshots.media_collection_id') END;
END;--> statement-breakpoint

CREATE TRIGGER `artwork_revisions_scope_insert`
BEFORE INSERT ON `artwork_revisions`
BEGIN
	SELECT CASE WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_items`
		WHERE `id` = NEW.`media_item_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_revisions.media_item_id') END;
	SELECT CASE WHEN NEW.`media_collection_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_collections`
		WHERE `id` = NEW.`media_collection_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_revisions.media_collection_id') END;
END;--> statement-breakpoint
CREATE TRIGGER `artwork_revisions_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id`, `media_collection_id` ON `artwork_revisions`
BEGIN
	SELECT CASE WHEN NEW.`media_item_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_items`
		WHERE `id` = NEW.`media_item_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_revisions.media_item_id') END;
	SELECT CASE WHEN NEW.`media_collection_id` IS NOT NULL AND NOT EXISTS (
		SELECT 1 FROM `media_collections`
		WHERE `id` = NEW.`media_collection_id`
			AND `server_instance_id` = NEW.`server_instance_id`
	) THEN RAISE(ABORT, 'scope_mismatch:artwork_revisions.media_collection_id') END;
END;--> statement-breakpoint

CREATE TRIGGER `provider_discovery_runs_scope_insert`
BEFORE INSERT ON `provider_discovery_runs`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:provider_discovery_runs.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `provider_discovery_runs_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `provider_discovery_runs`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:provider_discovery_runs.media_item_id');
END;--> statement-breakpoint

CREATE TRIGGER `provider_discovery_outcomes_scope_insert`
BEFORE INSERT ON `provider_discovery_outcomes`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:provider_discovery_outcomes.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `provider_discovery_outcomes_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `provider_discovery_outcomes`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:provider_discovery_outcomes.media_item_id');
END;--> statement-breakpoint

CREATE TRIGGER `review_events_scope_insert`
BEFORE INSERT ON `review_events`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:review_events.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `review_events_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `review_events`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:review_events.media_item_id');
END;--> statement-breakpoint

CREATE TRIGGER `resolution_audits_scope_insert`
BEFORE INSERT ON `resolution_audits`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:resolution_audits.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `resolution_audits_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `resolution_audits`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:resolution_audits.media_item_id');
END;--> statement-breakpoint

-- Protect the reverse direction too: changing a parent's namespace must not
-- strand already-linked children in the previous server scope.
CREATE TRIGGER `media_items_scope_update`
BEFORE UPDATE OF `server_instance_id` ON `media_items`
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
END;--> statement-breakpoint

CREATE TRIGGER `media_collections_scope_update`
BEFORE UPDATE OF `server_instance_id` ON `media_collections`
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
END;--> statement-breakpoint
PRAGMA foreign_keys=ON;
