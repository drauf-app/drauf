CREATE TABLE `entry_portions` (
	`id` text PRIMARY KEY NOT NULL,
	`entry_id` text NOT NULL,
	`quantity` real,
	`unit` text,
	`origin` text NOT NULL,
	`added_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`entry_id`) REFERENCES `list_entries`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `list_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`name_normalized` text NOT NULL,
	`variant` text,
	`note` text,
	`checked_at` integer,
	`checked_by_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`list_id`) REFERENCES `lists`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`checked_by_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `list_entries_list_name_idx` ON `list_entries` (`list_id`,`name_normalized`);