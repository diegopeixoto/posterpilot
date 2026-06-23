CREATE TABLE `events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`level` text NOT NULL,
	`type` text NOT NULL,
	`message` text NOT NULL,
	`context` text,
	`created_at` integer NOT NULL
);
