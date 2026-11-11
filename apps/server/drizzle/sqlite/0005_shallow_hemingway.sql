CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`key` text,
	`name` text NOT NULL,
	`sort_order` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_household_key_idx` ON `categories` (`household_id`,`key`) WHERE "categories"."key" IS NOT NULL;--> statement-breakpoint
CREATE TABLE `store_categories` (
	`store_id` text NOT NULL,
	`category_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`store_id`, `category_id`),
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `stores` (
	`id` text PRIMARY KEY NOT NULL,
	`household_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `list_entries` ADD `category_id` text REFERENCES categories(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `lists` ADD `default_store_id` text REFERENCES stores(id) ON DELETE SET NULL;