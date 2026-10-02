CREATE TABLE `price_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`variant` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_price_folders_owner` ON `price_folders` (`owner`);--> statement-breakpoint
CREATE TABLE `price_images` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`folder_id` text NOT NULL,
	`name` text NOT NULL,
	`object_key` text,
	`source` text,
	`mime` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_price_images_owner_folder` ON `price_images` (`owner`,`folder_id`);