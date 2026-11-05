CREATE TABLE `connections` (
	`provider` text PRIMARY KEY NOT NULL,
	`account_name` text NOT NULL,
	`access_token` text NOT NULL,
	`refresh_token` text,
	`expires_at` text,
	`scopes` text,
	`meta` text,
	`connected_at` text NOT NULL,
	`last_sync_at` text,
	`last_error` text
);
--> statement-breakpoint
CREATE TABLE `metric_totals` (
	`platform_id` text NOT NULL,
	`external_id` text NOT NULL,
	`baseline_date` text NOT NULL,
	`baseline` text NOT NULL,
	`latest` text NOT NULL,
	PRIMARY KEY(`platform_id`, `external_id`)
);
--> statement-breakpoint
ALTER TABLE `messages` ADD `external_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `messages_external` ON `messages` (`external_id`);