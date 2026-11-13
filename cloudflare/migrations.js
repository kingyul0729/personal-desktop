// 자동 생성 파일 (cloudflare/gen-migrations.mjs). 직접 고치지 마세요.
export default [
 {
  "name": "0000_ambiguous_nightshade",
  "statements": [
   "CREATE TABLE `price_folders` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`name` text NOT NULL,\n\t`variant` text NOT NULL,\n\t`created_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_price_folders_owner` ON `price_folders` (`owner`);",
   "CREATE TABLE `price_images` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`folder_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`object_key` text,\n\t`source` text,\n\t`mime` text NOT NULL,\n\t`created_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_price_images_owner_folder` ON `price_images` (`owner`,`folder_id`);"
  ]
 },
 {
  "name": "0001_spicy_leper_queen",
  "statements": [
   "ALTER TABLE `price_folders` ADD `catalog_version` integer DEFAULT 0 NOT NULL;"
  ]
 },
 {
  "name": "0002_youthful_toad_men",
  "statements": [
   "CREATE TABLE `memo_drafts` (\n\t`owner` text PRIMARY KEY NOT NULL,\n\t`memo_id` text NOT NULL,\n\t`title` text DEFAULT '' NOT NULL,\n\t`content` text NOT NULL,\n\t`updated_at` integer NOT NULL\n);",
   "CREATE TABLE `memos` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`title` text DEFAULT '' NOT NULL,\n\t`content` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`saved_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_memos_owner_saved` ON `memos` (`owner`,`saved_at`);"
  ]
 },
 {
  "name": "0003_famous_husk",
  "statements": [
   "CREATE TABLE `desktop_assets` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`object_key` text NOT NULL,\n\t`mime` text NOT NULL,\n\t`created_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_desktop_assets_owner` ON `desktop_assets` (`owner`);",
   "CREATE TABLE `desktop_items` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`target` text NOT NULL,\n\t`label` text,\n\t`icon` text,\n\t`hidden` integer DEFAULT 0 NOT NULL,\n\t`sort` integer NOT NULL,\n\t`created_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_desktop_items_owner` ON `desktop_items` (`owner`);",
   "CREATE TABLE `desktop_settings` (\n\t`owner` text PRIMARY KEY NOT NULL,\n\t`wallpaper_asset_id` text,\n\t`wallpaper_fit` text DEFAULT 'cover' NOT NULL,\n\t`updated_at` integer NOT NULL\n);",
   "CREATE TABLE `file_unlocks` (\n\t`token_hash` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`file_id` text NOT NULL,\n\t`expires_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_file_unlocks_owner_file` ON `file_unlocks` (`owner`,`file_id`);",
   "CREATE TABLE `user_files` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`parent_id` text,\n\t`kind` text NOT NULL,\n\t`name` text NOT NULL,\n\t`content` text DEFAULT '' NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`trashed_at` integer,\n\t`lock_hash` text,\n\t`lock_salt` text,\n\t`lock_failures` integer DEFAULT 0 NOT NULL,\n\t`lock_retry_at` integer DEFAULT 0 NOT NULL\n);",
   "CREATE INDEX `idx_user_files_owner_parent` ON `user_files` (`owner`,`parent_id`);"
  ]
 },
 {
  "name": "0004_careful_machine_man",
  "statements": [
   "CREATE TABLE `work_capsules` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`name` text NOT NULL,\n\t`layout` text NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_work_capsules_owner` ON `work_capsules` (`owner`);"
  ]
 },
 {
  "name": "0005_deep_eternals",
  "statements": [
   "ALTER TABLE `memos` ADD `trashed_at` integer;",
   "ALTER TABLE `price_images` ADD `trashed_at` integer;",
   "ALTER TABLE `work_capsules` ADD `trashed_at` integer;"
  ]
 },
 {
  "name": "0006_calm_cerise",
  "statements": [
   "ALTER TABLE `desktop_settings` ADD `font` text;"
  ]
 },
 {
  "name": "0007_ancient_natasha_romanoff",
  "statements": [
   "CREATE TABLE `study_attachments` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`record_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`object_key` text NOT NULL,\n\t`mime` text NOT NULL,\n\t`size` integer NOT NULL,\n\t`created_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_study_attachments_record` ON `study_attachments` (`owner`,`record_id`);",
   "CREATE TABLE `study_records` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`title` text NOT NULL,\n\t`category` text NOT NULL,\n\t`studied_on` text NOT NULL,\n\t`content` text DEFAULT '' NOT NULL,\n\t`tags` text DEFAULT '' NOT NULL,\n\t`favorite` integer DEFAULT 0 NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`trashed_at` integer\n);",
   "CREATE INDEX `idx_study_records_owner` ON `study_records` (`owner`,`updated_at`);"
  ]
 },
 {
  "name": "0008_marvelous_molly_hayes",
  "statements": [
   "ALTER TABLE `study_records` ADD `keywords` text DEFAULT '' NOT NULL;",
   "ALTER TABLE `study_records` ADD `summary` text DEFAULT '' NOT NULL;"
  ]
 },
 {
  "name": "0009_milky_invaders",
  "statements": [
   "CREATE TABLE `work_doc_attachments` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`doc_id` text NOT NULL,\n\t`name` text NOT NULL,\n\t`object_key` text NOT NULL,\n\t`mime` text NOT NULL,\n\t`size` integer NOT NULL,\n\t`created_at` integer NOT NULL\n);",
   "CREATE INDEX `idx_work_doc_attachments_doc` ON `work_doc_attachments` (`owner`,`doc_id`);",
   "CREATE TABLE `work_docs` (\n\t`id` text PRIMARY KEY NOT NULL,\n\t`owner` text NOT NULL,\n\t`kind` text NOT NULL,\n\t`title` text NOT NULL,\n\t`summary` text DEFAULT '' NOT NULL,\n\t`content` text DEFAULT '' NOT NULL,\n\t`created_at` integer NOT NULL,\n\t`updated_at` integer NOT NULL,\n\t`trashed_at` integer\n);",
   "CREATE INDEX `idx_work_docs_owner` ON `work_docs` (`owner`,`updated_at`);"
  ]
 },
 {
  "name": "0010_study_ink",
  "statements": [
   "ALTER TABLE `study_records` ADD `ink` text DEFAULT '' NOT NULL;"
  ]
 },
 {
  "name": "0011_price_folder_trash",
  "statements": [
   "ALTER TABLE `price_folders` ADD `trashed_at` integer;"
  ]
 }
];
