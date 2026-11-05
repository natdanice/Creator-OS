CREATE TABLE `account_daily` (
	`platform_id` text NOT NULL,
	`date` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`profile_views` integer DEFAULT 0 NOT NULL,
	`likes` integer DEFAULT 0 NOT NULL,
	`comments` integer DEFAULT 0 NOT NULL,
	`shares` integer DEFAULT 0 NOT NULL,
	`new_followers` integer DEFAULT 0 NOT NULL,
	`lost_followers` integer,
	`followers` integer,
	PRIMARY KEY(`platform_id`, `date`),
	FOREIGN KEY (`platform_id`) REFERENCES `platforms`(`id`) ON UPDATE no action ON DELETE no action
);
