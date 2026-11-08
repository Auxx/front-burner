CREATE TABLE `sync_state` (
	`repository_id` integer PRIMARY KEY NOT NULL,
	`fetch_problem` text,
	FOREIGN KEY (`repository_id`) REFERENCES `repositories`(`id`) ON UPDATE no action ON DELETE cascade
);
