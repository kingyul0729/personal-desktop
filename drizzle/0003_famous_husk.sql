CREATE TABLE `desktop_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_desktop_assets_owner` ON `desktop_assets` (`owner`);--> statement-breakpoint
CREATE TABLE `desktop_items` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`label` text,
	`icon` text,
	`hidden` integer DEFAULT 0 NOT NULL,
	`sort` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_desktop_items_owner` ON `desktop_items` (`owner`);--> statement-breakpoint
CREATE TABLE `desktop_settings` (
	`owner` text PRIMARY KEY NOT NULL,
	`wallpaper_asset_id` text,
	`wallpaper_fit` text DEFAULT 'cover' NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `file_unlocks` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`file_id` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_file_unlocks_owner_file` ON `file_unlocks` (`owner`,`file_id`);--> statement-breakpoint
CREATE TABLE `user_files` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`parent_id` text,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`trashed_at` integer,
	`lock_hash` text,
	`lock_salt` text,
	`lock_failures` integer DEFAULT 0 NOT NULL,
	`lock_retry_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_user_files_owner_parent` ON `user_files` (`owner`,`parent_id`);