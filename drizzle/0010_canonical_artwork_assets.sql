ALTER TABLE `media_items` ADD `selected_poster_provider` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `selected_background_provider` text;--> statement-breakpoint
ALTER TABLE `media_items` ADD `selection_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `poster_candidates` ADD `language_provenance` text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE `poster_candidates` ADD `preview_url` text;
--> statement-breakpoint
CREATE TEMP TABLE `_posterpilot_root_selection_matches` AS
SELECT
	`item`.`id` AS `media_item_id`,
	'poster' AS `slot`,
	`candidate`.`id` AS `candidate_id`,
	`candidate`.`provider` AS `provider`
FROM `media_items` AS `item`
JOIN `poster_candidates` AS `candidate`
	ON `candidate`.`server_instance_id` = `item`.`server_instance_id`
	AND `candidate`.`media_item_id` = `item`.`id`
	AND `candidate`.`kind` = 'poster'
	AND `candidate`.`season` IS NULL
	AND `candidate`.`episode` IS NULL
WHERE `item`.`selected_poster_url` IS NOT NULL
	AND (
		`candidate`.`url` = `item`.`selected_poster_url`
		OR (
			`candidate`.`provider` = 'tmdb'
			AND `candidate`.`url` LIKE 'https://image.tmdb.org/t/p/%/%'
			AND `item`.`selected_poster_url` LIKE 'https://image.tmdb.org/t/p/%/%'
			AND substr(
				substr(`candidate`.`url`, length('https://image.tmdb.org/t/p/') + 1),
				instr(substr(`candidate`.`url`, length('https://image.tmdb.org/t/p/') + 1), '/') + 1
			) = substr(
				substr(`item`.`selected_poster_url`, length('https://image.tmdb.org/t/p/') + 1),
				instr(substr(`item`.`selected_poster_url`, length('https://image.tmdb.org/t/p/') + 1), '/') + 1
			)
		)
	)
UNION ALL
SELECT
	`item`.`id` AS `media_item_id`,
	'background' AS `slot`,
	`candidate`.`id` AS `candidate_id`,
	`candidate`.`provider` AS `provider`
FROM `media_items` AS `item`
JOIN `poster_candidates` AS `candidate`
	ON `candidate`.`server_instance_id` = `item`.`server_instance_id`
	AND `candidate`.`media_item_id` = `item`.`id`
	AND `candidate`.`kind` = 'background'
	AND `candidate`.`season` IS NULL
	AND `candidate`.`episode` IS NULL
WHERE `item`.`selected_background_url` IS NOT NULL
	AND (
		`candidate`.`url` = `item`.`selected_background_url`
		OR (
			`candidate`.`provider` = 'tmdb'
			AND `candidate`.`url` LIKE 'https://image.tmdb.org/t/p/%/%'
			AND `item`.`selected_background_url` LIKE 'https://image.tmdb.org/t/p/%/%'
			AND substr(
				substr(`candidate`.`url`, length('https://image.tmdb.org/t/p/') + 1),
				instr(substr(`candidate`.`url`, length('https://image.tmdb.org/t/p/') + 1), '/') + 1
			) = substr(
				substr(`item`.`selected_background_url`, length('https://image.tmdb.org/t/p/') + 1),
				instr(substr(`item`.`selected_background_url`, length('https://image.tmdb.org/t/p/') + 1), '/') + 1
			)
		)
	);--> statement-breakpoint
UPDATE `media_items` AS `item`
SET `selected_poster_provider` = COALESCE(
	(
		SELECT `match`.`provider`
		FROM `_posterpilot_root_selection_matches` AS `match`
		WHERE `match`.`media_item_id` = `item`.`id`
			AND `match`.`slot` = 'poster'
			AND `match`.`candidate_id` = `item`.`selected_poster_candidate_id`
		LIMIT 1
	),
	(
		SELECT CASE
			WHEN count(DISTINCT `match`.`provider`) = 1 THEN min(`match`.`provider`)
		END
		FROM `_posterpilot_root_selection_matches` AS `match`
		WHERE `match`.`media_item_id` = `item`.`id`
			AND `match`.`slot` = 'poster'
	)
)
WHERE `item`.`selected_poster_url` IS NOT NULL;--> statement-breakpoint
UPDATE `media_items` AS `item`
SET `selected_poster_candidate_id` = NULL
WHERE `item`.`selected_poster_candidate_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `_posterpilot_root_selection_matches` AS `match`
		WHERE `match`.`media_item_id` = `item`.`id`
			AND `match`.`slot` = 'poster'
			AND `match`.`candidate_id` = `item`.`selected_poster_candidate_id`
			AND `match`.`provider` = `item`.`selected_poster_provider`
	);--> statement-breakpoint
UPDATE `media_items`
SET `selected_poster_provider` = 'custom', `selected_poster_candidate_id` = NULL
WHERE `selected_poster_url` IS NOT NULL AND `selected_poster_provider` IS NULL;--> statement-breakpoint
UPDATE `media_items`
SET `selected_poster_provider` = NULL, `selected_poster_candidate_id` = NULL
WHERE `selected_poster_url` IS NULL;--> statement-breakpoint
UPDATE `media_items` AS `item`
SET `selected_background_provider` = COALESCE(
	(
		SELECT `match`.`provider`
		FROM `_posterpilot_root_selection_matches` AS `match`
		WHERE `match`.`media_item_id` = `item`.`id`
			AND `match`.`slot` = 'background'
			AND `match`.`candidate_id` = `item`.`selected_background_candidate_id`
		LIMIT 1
	),
	(
		SELECT CASE
			WHEN count(DISTINCT `match`.`provider`) = 1 THEN min(`match`.`provider`)
		END
		FROM `_posterpilot_root_selection_matches` AS `match`
		WHERE `match`.`media_item_id` = `item`.`id`
			AND `match`.`slot` = 'background'
	)
)
WHERE `item`.`selected_background_url` IS NOT NULL;--> statement-breakpoint
UPDATE `media_items` AS `item`
SET `selected_background_candidate_id` = NULL
WHERE `item`.`selected_background_candidate_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `_posterpilot_root_selection_matches` AS `match`
		WHERE `match`.`media_item_id` = `item`.`id`
			AND `match`.`slot` = 'background'
			AND `match`.`candidate_id` = `item`.`selected_background_candidate_id`
			AND `match`.`provider` = `item`.`selected_background_provider`
	);--> statement-breakpoint
UPDATE `media_items`
SET `selected_background_provider` = 'custom', `selected_background_candidate_id` = NULL
WHERE `selected_background_url` IS NOT NULL AND `selected_background_provider` IS NULL;--> statement-breakpoint
UPDATE `media_items`
SET `selected_background_provider` = NULL, `selected_background_candidate_id` = NULL
WHERE `selected_background_url` IS NULL;--> statement-breakpoint
DROP TABLE `_posterpilot_root_selection_matches`;--> statement-breakpoint
CREATE TEMP TABLE `_posterpilot_child_selection_matches` AS
SELECT
	`selection`.`id` AS `selection_id`,
	`candidate`.`id` AS `candidate_id`,
	`candidate`.`provider` AS `provider`,
	`candidate`.`set_id` AS `set_id`
FROM `child_selections` AS `selection`
JOIN `poster_candidates` AS `candidate`
	ON `candidate`.`server_instance_id` = `selection`.`server_instance_id`
	AND `candidate`.`media_item_id` = `selection`.`media_item_id`
	AND `candidate`.`season` = `selection`.`season`
	AND (
		(`selection`.`episode` IS NULL AND `candidate`.`episode` IS NULL)
		OR `candidate`.`episode` = `selection`.`episode`
	)
	AND (
		(`selection`.`kind` = 'poster' AND `candidate`.`kind` IN ('poster', 'season'))
		OR (`selection`.`kind` = 'background' AND `candidate`.`kind` = 'background')
		OR (`selection`.`kind` = 'title_card' AND `candidate`.`kind` = 'title_card')
	)
WHERE `candidate`.`url` = `selection`.`url`
	OR (
		`candidate`.`provider` = 'tmdb'
		AND `candidate`.`url` LIKE 'https://image.tmdb.org/t/p/%/%'
		AND `selection`.`url` LIKE 'https://image.tmdb.org/t/p/%/%'
		AND substr(
			substr(`candidate`.`url`, length('https://image.tmdb.org/t/p/') + 1),
			instr(substr(`candidate`.`url`, length('https://image.tmdb.org/t/p/') + 1), '/') + 1
		) = substr(
			substr(`selection`.`url`, length('https://image.tmdb.org/t/p/') + 1),
			instr(substr(`selection`.`url`, length('https://image.tmdb.org/t/p/') + 1), '/') + 1
		)
	);--> statement-breakpoint
UPDATE `child_selections` AS `selection`
SET `provider` = COALESCE(
	(
		SELECT `match`.`provider`
		FROM `_posterpilot_child_selection_matches` AS `match`
		WHERE `match`.`selection_id` = `selection`.`id`
			AND `match`.`candidate_id` = `selection`.`candidate_id`
		LIMIT 1
	),
	(
		SELECT CASE
			WHEN count(DISTINCT `match`.`provider`) = 1 THEN min(`match`.`provider`)
		END
		FROM `_posterpilot_child_selection_matches` AS `match`
		WHERE `match`.`selection_id` = `selection`.`id`
	)
)
WHERE `selection`.`provider` IS NULL;--> statement-breakpoint
UPDATE `child_selections` AS `selection`
SET `set_id` = (
	SELECT `match`.`set_id`
	FROM `_posterpilot_child_selection_matches` AS `match`
	WHERE `match`.`selection_id` = `selection`.`id`
		AND `match`.`candidate_id` = `selection`.`candidate_id`
		AND `match`.`provider` = `selection`.`provider`
	LIMIT 1
)
WHERE `selection`.`candidate_id` IS NOT NULL;--> statement-breakpoint
UPDATE `child_selections` AS `selection`
SET `candidate_id` = NULL, `set_id` = NULL
WHERE `selection`.`candidate_id` IS NOT NULL
	AND NOT EXISTS (
		SELECT 1
		FROM `_posterpilot_child_selection_matches` AS `match`
		WHERE `match`.`selection_id` = `selection`.`id`
			AND `match`.`candidate_id` = `selection`.`candidate_id`
			AND `match`.`provider` = `selection`.`provider`
	);--> statement-breakpoint
UPDATE `child_selections`
SET `set_id` = NULL
WHERE `candidate_id` IS NULL;--> statement-breakpoint
UPDATE `child_selections`
SET `provider` = 'custom', `candidate_id` = NULL, `set_id` = NULL
WHERE `provider` IS NULL;--> statement-breakpoint
DROP TABLE `_posterpilot_child_selection_matches`;
