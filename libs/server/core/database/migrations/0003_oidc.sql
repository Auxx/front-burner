CREATE TABLE `system_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`automatic_registration` integer DEFAULT false NOT NULL,
	`oidc_issuer` text,
	`oidc_client_id` text,
	`oidc_client_secret` text,
	`oidc_scopes` text,
	`oidc_require_verified_email` integer,
	CONSTRAINT "system_settings_single_row" CHECK("system_settings"."id" = 1)
);
--> statement-breakpoint
ALTER TABLE `instance_state` ADD `pending_admin_email` text;--> statement-breakpoint
ALTER TABLE `users` ADD `oidc_issuer` text;--> statement-breakpoint
ALTER TABLE `users` ADD `oidc_subject` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_oidc_identity_unique` ON `users` (`oidc_issuer`,`oidc_subject`);