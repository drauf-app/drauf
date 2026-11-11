CREATE TABLE `catalog_usage` (
	`household_id` text NOT NULL,
	`name_normalized` text NOT NULL,
	`name` text NOT NULL,
	`count` integer NOT NULL,
	`category_id` text,
	`last_quantity` real,
	`last_unit` text,
	`last_variant` text,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`household_id`, `name_normalized`),
	FOREIGN KEY (`household_id`) REFERENCES `households`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null
);
