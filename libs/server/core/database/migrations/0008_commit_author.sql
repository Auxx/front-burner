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
INSERT INTO `user_preferences` (`user_id`, `commit_author_name`, `commit_author_email`, `commit_author_confirmed`)
SELECT `id`, COALESCE(NULLIF(`cleaned`, ''), NULLIF(substr(`email`, 1, instr(`email`, '@') - 1), ''), `email`), `email`, 0
FROM (
	SELECT `id`, `email`, trim(substr(trim(replace(replace(replace(replace(replace(`display_name`, '<', ''), '>', ''), char(9), ' '), char(10), ' '), char(13), ' ')), 1, 255)) AS `cleaned`
	FROM `users`
);
