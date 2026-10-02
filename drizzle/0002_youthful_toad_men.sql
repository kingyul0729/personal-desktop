CREATE TABLE `memo_drafts` (
	`owner` text PRIMARY KEY NOT NULL,
	`memo_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memos` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`content` text NOT NULL,
	`created_at` integer NOT NULL,
	`saved_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_memos_owner_saved` ON `memos` (`owner`,`saved_at`);