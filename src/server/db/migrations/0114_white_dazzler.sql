CREATE TABLE `chat_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_chat_folders_user` ON `chat_folders` (`user_id`);--> statement-breakpoint
ALTER TABLE `quick_sessions` ADD `folder_id` text REFERENCES chat_folders(id);--> statement-breakpoint
ALTER TABLE `quick_sessions` ADD `pinned` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `quick_sessions` ADD `updated_at` integer;--> statement-breakpoint
CREATE INDEX `idx_quick_sessions_user_kind` ON `quick_sessions` (`created_by`,`kind`);