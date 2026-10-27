CREATE TABLE `repositories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`remote_url` text NOT NULL,
	`clone_mode` text NOT NULL,
	`branch` text,
	`git_level` text NOT NULL,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`last_accessed_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repositories_user_name_unique` ON `repositories` (`user_id`,lower("name"));--> statement-breakpoint
CREATE INDEX `repositories_user_last_accessed` ON `repositories` (`user_id`,`last_accessed_at`);