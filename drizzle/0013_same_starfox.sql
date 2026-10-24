CREATE TABLE `artwork_field_locks` (
	`server_instance_id` text NOT NULL,
	`target_id` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`server_instance_id`) REFERENCES `server_instances`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artwork_field_locks_slot_unique` ON `artwork_field_locks` (`server_instance_id`,`target_id`,`kind`);