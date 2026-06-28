CREATE TABLE `child_selections` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_item_id` integer NOT NULL,
	`kind` text NOT NULL,
	`season` integer NOT NULL,
	`episode` integer,
	`url` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`media_item_id`) REFERENCES `media_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `child_selections_season_slot` ON `child_selections` (`media_item_id`,`kind`,`season`) WHERE "child_selections"."episode" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `child_selections_episode_slot` ON `child_selections` (`media_item_id`,`kind`,`season`,`episode`) WHERE "child_selections"."episode" is not null;--> statement-breakpoint
ALTER TABLE `applied_posters` ADD `kind` text;--> statement-breakpoint
ALTER TABLE `applied_posters` ADD `season` integer;--> statement-breakpoint
ALTER TABLE `applied_posters` ADD `episode` integer;