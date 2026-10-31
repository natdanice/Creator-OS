CREATE TABLE `activities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`deal_id` integer,
	`type` text NOT NULL,
	`channel` text NOT NULL,
	`summary` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `activities_brand` ON `activities` (`brand_id`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `audience_breakdown` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`snapshot_id` integer NOT NULL,
	`dimension` text NOT NULL,
	`bucket` text NOT NULL,
	`pct` real NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `audience_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audience_snapshots` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` text NOT NULL,
	`month` text NOT NULL,
	`followers` integer NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audience_platform_month` ON `audience_snapshots` (`platform_id`,`month`);--> statement-breakpoint
CREATE TABLE `automation_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`trigger` text NOT NULL,
	`channel` text NOT NULL,
	`schedule` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_run_at` text
);
--> statement-breakpoint
CREATE TABLE `automation_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`for_date` text NOT NULL,
	`ran_at` text NOT NULL,
	`created` integer NOT NULL,
	`skipped` integer NOT NULL,
	`detail` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `brand_contacts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`channel` text NOT NULL,
	`handle` text NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `brands` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`website` text,
	`notes` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` text NOT NULL,
	`content_id` integer NOT NULL,
	`author_pseudo_id` text NOT NULL,
	`text` text NOT NULL,
	`category` text NOT NULL,
	`classifier` text NOT NULL,
	`redacted` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_pseudo_id`) REFERENCES `pseudonyms`(`pseudo_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `comments_content` ON `comments` (`content_id`);--> statement-breakpoint
CREATE INDEX `comments_created` ON `comments` (`created_at`);--> statement-breakpoint
CREATE TABLE `consents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subject_pseudo_id` text NOT NULL,
	`purpose` text NOT NULL,
	`lawful_basis` text NOT NULL,
	`status` text NOT NULL,
	`source` text NOT NULL,
	`granted_at` text NOT NULL,
	`withdrawn_at` text,
	FOREIGN KEY (`subject_pseudo_id`) REFERENCES `pseudonyms`(`pseudo_id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `content_metrics_daily` (
	`content_id` integer NOT NULL,
	`date` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`comments` integer DEFAULT 0 NOT NULL,
	`shares` integer DEFAULT 0 NOT NULL,
	`saves` integer DEFAULT 0 NOT NULL,
	`profile_views` integer DEFAULT 0 NOT NULL,
	`new_followers` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`content_id`, `date`),
	FOREIGN KEY (`content_id`) REFERENCES `contents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `metrics_date` ON `content_metrics_daily` (`date`);--> statement-breakpoint
CREATE TABLE `contents` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` text NOT NULL,
	`external_id` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`product_category` text NOT NULL,
	`posted_at` text NOT NULL,
	`is_sponsored` integer DEFAULT false NOT NULL,
	`deal_id` integer,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contents_platform_ext` ON `contents` (`platform_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `contents_deal` ON `contents` (`deal_id`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`title` text NOT NULL,
	`stage` text NOT NULL,
	`value` integer NOT NULL,
	`currency` text DEFAULT 'THB' NOT NULL,
	`deliverables` text NOT NULL,
	`created_at` text NOT NULL,
	`posted_at` text,
	`closed_at` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deals_brand` ON `deals` (`brand_id`);--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`platform_id` text NOT NULL,
	`adapter` text NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`status` text NOT NULL,
	`contents` integer DEFAULT 0 NOT NULL,
	`metric_rows` integer DEFAULT 0 NOT NULL,
	`comments` integer DEFAULT 0 NOT NULL,
	`audience_snapshots` integer DEFAULT 0 NOT NULL,
	`message` text,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `invoices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`number` text NOT NULL,
	`amount` integer NOT NULL,
	`issued_at` text NOT NULL,
	`due_at` text NOT NULL,
	`paid_at` text,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_number_unique` ON `invoices` (`number`);--> statement-breakpoint
CREATE TABLE `platforms` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`handle` text NOT NULL,
	`color` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `pseudonyms` (
	`pseudo_id` text PRIMARY KEY NOT NULL,
	`handle_hash` text NOT NULL,
	`first_seen_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pseudonyms_handle_hash_unique` ON `pseudonyms` (`handle_hash`);--> statement-breakpoint
CREATE TABLE `quote_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`quote_id` integer NOT NULL,
	`rate_card_id` integer NOT NULL,
	`qty` integer NOT NULL,
	`unit_price` integer NOT NULL,
	FOREIGN KEY (`quote_id`) REFERENCES `quotes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`rate_card_id`) REFERENCES `rate_card`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `quotes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`number` text NOT NULL,
	`brand_id` integer NOT NULL,
	`deal_id` integer,
	`created_at` text NOT NULL,
	`valid_until` text NOT NULL,
	`discount_pct` integer DEFAULT 0 NOT NULL,
	`notes` text,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `quotes_number_unique` ON `quotes` (`number`);--> statement-breakpoint
CREATE TABLE `rate_card` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`platform_id` text,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`price` integer NOT NULL,
	`includes` text NOT NULL,
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_card_code_unique` ON `rate_card` (`code`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`rule_id` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`title` text NOT NULL,
	`reason` text NOT NULL,
	`draft_message` text NOT NULL,
	`channel` text NOT NULL,
	`brand_id` integer,
	`deal_id` integer,
	`link` text,
	`status` text DEFAULT 'open' NOT NULL,
	`for_date` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`rule_id`) REFERENCES `automation_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_dedupe` ON `tasks` (`dedupe_key`);