ALTER TABLE `users` ADD `avatar_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_avatar_key_unique` ON `users` (`avatar_key`);