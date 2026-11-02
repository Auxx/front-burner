CREATE TABLE `user_preferences` (
	`user_id` integer PRIMARY KEY NOT NULL,
	`commit_author_name` text NOT NULL,
	`commit_author_email` text NOT NULL,
	`commit_author_confirmed` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `repositories` ADD `commit_author_name` text;--> statement-breakpoint
ALTER TABLE `repositories` ADD `commit_author_email` text;--> statement-breakpoint
INSERT INTO `user_preferences` (`user_id`, `commit_author_name`, `commit_author_email`, `commit_author_confirmed`) SELECT `id`, `display_name`, `email`, 0 FROM `users`;
