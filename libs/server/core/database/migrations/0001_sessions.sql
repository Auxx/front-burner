CREATE TABLE `login_audit` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`at` integer NOT NULL,
	`method` text NOT NULL,
	`outcome` text NOT NULL,
	`reason` text NOT NULL,
	`email` text,
	`issuer` text,
	`subject` text,
	`provider_error` text,
	`provider_error_description` text,
	`ip` text,
	`user_agent` text,
	`session_id` text,
	`user_id` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `login_audit_at` ON `login_audit` (`at`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` integer NOT NULL,
	`login_method` text NOT NULL,
	`refresh_token_delivery` text NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`auth_token_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_id` ON `sessions` (`user_id`);--> statement-breakpoint
ALTER TABLE `users` ADD `disabled` integer DEFAULT false NOT NULL;