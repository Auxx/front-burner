ALTER TABLE `jobs` ADD `repository_id` integer REFERENCES repositories(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `repositories` ADD `credential_id` integer REFERENCES saved_credentials(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `users` ADD `allowed_git_levels` text DEFAULT '["advanced"]' NOT NULL;