CREATE TABLE `known_hosts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`host` text NOT NULL,
	`port` integer NOT NULL,
	`key_type` text NOT NULL,
	`public_key` text NOT NULL,
	`fingerprint` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `known_hosts_user_host_port_type_unique` ON `known_hosts` (`user_id`,`host`,`port`,`key_type`);--> statement-breakpoint
CREATE TABLE `saved_credentials` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`username` text,
	`secret` text,
	`ssh_key_type` text,
	`ssh_public_key` text,
	`ssh_fingerprint` text,
	`ssh_passphrase_protected` integer,
	`ssh_generated` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_credentials_user_kind_name_unique` ON `saved_credentials` (`user_id`,`kind`,lower("name"));