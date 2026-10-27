CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`type` text NOT NULL,
	`user_id` integer,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text NOT NULL,
	`run_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`finished_at` integer,
	`attempts` integer DEFAULT 0 NOT NULL,
	`progress` integer,
	`result` text,
	`error_code` text,
	`dedupe_key` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_dedupe_unfinished` ON `jobs` (`dedupe_key`) WHERE status IN ('queued', 'running');--> statement-breakpoint
CREATE INDEX `jobs_status_run_at` ON `jobs` (`status`,`run_at`);