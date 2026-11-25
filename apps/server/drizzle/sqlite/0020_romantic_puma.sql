PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_plan_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`date` text NOT NULL,
	`slot_id` text,
	`text` text,
	`link` text,
	`image_url` text,
	`cook_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`slot_id`) REFERENCES `meal_slots`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`cook_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_plan_entries`("id", "household_id", "date", "slot_id", "text", "link", "image_url", "cook_id", "created_at") SELECT "id", "household_id", "date", "slot_id", "text", "link", "image_url", "cook_id", "created_at" FROM `plan_entries`;--> statement-breakpoint
DROP TABLE `plan_entries`;--> statement-breakpoint
ALTER TABLE `__new_plan_entries` RENAME TO `plan_entries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `plan_entries_day_idx` ON `plan_entries` (`household_id`,`date`);