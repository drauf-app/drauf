CREATE TABLE `store_excluded_categories` (
	`store_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`store_id`, `category_id`),
	FOREIGN KEY (`store_id`) REFERENCES `stores`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
