CREATE TABLE `messages` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`brand_id` integer NOT NULL,
	`direction` text NOT NULL,
	`channel` text NOT NULL,
	`body` text NOT NULL,
	`sent_at` text NOT NULL,
	`read_at` text,
	`brief` text,
	`brief_status` text DEFAULT 'none' NOT NULL,
	`deal_id` integer,
	`task_id` integer,
	FOREIGN KEY (`brand_id`) REFERENCES `brands`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_brand` ON `messages` (`brand_id`);--> statement-breakpoint
ALTER TABLE `comments` ADD `reply_status` text DEFAULT 'open' NOT NULL;--> statement-breakpoint
ALTER TABLE `comments` ADD `reply_text` text;--> statement-breakpoint
ALTER TABLE `comments` ADD `replied_at` text;