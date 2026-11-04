CREATE TABLE `work_doc_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`doc_id` text NOT NULL,
	`name` text NOT NULL,
	`object_key` text NOT NULL,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_work_doc_attachments_doc` ON `work_doc_attachments` (`owner`,`doc_id`);--> statement-breakpoint
CREATE TABLE `work_docs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`trashed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_work_docs_owner` ON `work_docs` (`owner`,`updated_at`);