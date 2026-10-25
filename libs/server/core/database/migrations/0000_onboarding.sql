CREATE TABLE `instance_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`onboarding_state` text NOT NULL,
	CONSTRAINT "instance_state_single_row" CHECK("instance_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text NOT NULL,
	`login_method` text NOT NULL,
	`password_hash` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_lower_unique` ON `users` (lower("email"));