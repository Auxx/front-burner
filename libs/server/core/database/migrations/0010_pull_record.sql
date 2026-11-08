ALTER TABLE `sync_state` ADD `recorded_commit` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `merge_commit` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `earlier_recorded_commit` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `earlier_merge_commit` text;--> statement-breakpoint
ALTER TABLE `sync_state` ADD `merge_applying` integer DEFAULT false NOT NULL;