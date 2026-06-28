CREATE TABLE `thumbnail_cache` (
	`url_hash` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`fetched_at` integer NOT NULL,
	`accessed_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `media_items` ADD `ignored` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `media_items` ADD `server_updated_at` integer;--> statement-breakpoint
ALTER TABLE `media_items` ADD `last_synced_at` integer;--> statement-breakpoint
ALTER TABLE `poster_candidates` ADD `width` integer;--> statement-breakpoint
ALTER TABLE `poster_candidates` ADD `height` integer;--> statement-breakpoint
ALTER TABLE `poster_candidates` ADD `score` real;