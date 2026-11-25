CREATE TABLE `price_programs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`price` integer,
	`items` text DEFAULT '[]' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`updated_at` integer NOT NULL
);--> statement-breakpoint
CREATE INDEX `idx_price_programs_owner` ON `price_programs` (`owner`,`category`);
