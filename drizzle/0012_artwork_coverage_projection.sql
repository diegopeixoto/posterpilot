CREATE TABLE `artwork_coverage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`server_instance_id` text NOT NULL,
	`media_item_id` integer NOT NULL,
	`library_section_key` text NOT NULL,
	`canonical_key` text,
	`destination` text NOT NULL,
	`kind` text NOT NULL,
	`season` integer,
	`episode` integer,
	`status` text NOT NULL,
	`evidence_source` text NOT NULL,
	`evidence_revision_id` text,
	`evidence_fingerprint` text,
	`evidence_detail` text,
	`observed_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`evidence_revision_id`) REFERENCES `artwork_revisions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "artwork_coverage_status_destination_check" CHECK(("artwork_coverage"."destination" = 'server' and "artwork_coverage"."status" in ('applied_on_server', 'recorded_unverified', 'externally_changed', 'missing', 'unknown')) or ("artwork_coverage"."destination" = 'kometa' and "artwork_coverage"."status" in ('exported_to_kometa', 'missing', 'unknown')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_coverage_root_slot_unique` ON `artwork_coverage` (`server_instance_id`,`media_item_id`,`destination`,`kind`) WHERE "artwork_coverage"."season" is null and "artwork_coverage"."episode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_coverage_season_slot_unique` ON `artwork_coverage` (`server_instance_id`,`media_item_id`,`destination`,`kind`,`season`) WHERE "artwork_coverage"."season" is not null and "artwork_coverage"."episode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_coverage_episode_slot_unique` ON `artwork_coverage` (`server_instance_id`,`media_item_id`,`destination`,`kind`,`season`,`episode`) WHERE "artwork_coverage"."episode" is not null;--> statement-breakpoint
CREATE INDEX `artwork_coverage_item_idx` ON `artwork_coverage` (`server_instance_id`,`media_item_id`,`destination`);--> statement-breakpoint
CREATE INDEX `artwork_coverage_library_status_idx` ON `artwork_coverage` (`server_instance_id`,`library_section_key`,`destination`,`status`);--> statement-breakpoint
CREATE INDEX `artwork_coverage_canonical_idx` ON `artwork_coverage` (`canonical_key`,`destination`,`kind`) WHERE "artwork_coverage"."canonical_key" is not null;--> statement-breakpoint
CREATE INDEX `artwork_coverage_stale_idx` ON `artwork_coverage` (`server_instance_id`,`observed_at`);--> statement-breakpoint
CREATE TRIGGER `artwork_coverage_scope_insert`
BEFORE INSERT ON `artwork_coverage`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:artwork_coverage.media_item_id');
END;--> statement-breakpoint
CREATE TRIGGER `artwork_coverage_scope_update`
BEFORE UPDATE OF `server_instance_id`, `media_item_id` ON `artwork_coverage`
WHEN NOT EXISTS (
	SELECT 1 FROM `media_items`
	WHERE `id` = NEW.`media_item_id`
		AND `server_instance_id` = NEW.`server_instance_id`
)
BEGIN
	SELECT RAISE(ABORT, 'scope_mismatch:artwork_coverage.media_item_id');
END;
