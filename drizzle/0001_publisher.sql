CREATE TABLE `media_assets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`original_name` text NOT NULL,
	`stored_name` text NOT NULL,
	`mime` text NOT NULL,
	`kind` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`duration_sec` real,
	`uploaded_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `publications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`platform_id` text NOT NULL,
	`title` text,
	`caption` text NOT NULL,
	`options` text NOT NULL,
	`status` text NOT NULL,
	`external_id` text,
	`content_id` integer,
	`published_at` text,
	`error` text,
	FOREIGN KEY (`job_id`) REFERENCES `publish_jobs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `publications_job` ON `publications` (`job_id`);--> statement-breakpoint
CREATE TABLE `publish_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`media_id` integer NOT NULL,
	`caption` text NOT NULL,
	`hashtags` text NOT NULL,
	`content_type` text NOT NULL,
	`product_category` text NOT NULL,
	`deal_id` integer,
	`sponsored` integer DEFAULT false NOT NULL,
	`scheduled_at` text,
	`status` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`media_id`) REFERENCES `media_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `tasks` ADD `vars` text;