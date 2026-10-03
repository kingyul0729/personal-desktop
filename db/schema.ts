import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const priceFolders = sqliteTable('price_folders', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  variant: text('variant').notNull(), createdAt: integer('created_at').notNull(),
  catalogVersion: integer('catalog_version').notNull().default(0),
}, (t) => [index('idx_price_folders_owner').on(t.owner)]);

export const priceImages = sqliteTable('price_images', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), folderId: text('folder_id').notNull(),
  name: text('name').notNull(), objectKey: text('object_key'), source: text('source'),
  mime: text('mime').notNull(), createdAt: integer('created_at').notNull(),
  trashedAt: integer('trashed_at'),
}, (t) => [index('idx_price_images_owner_folder').on(t.owner, t.folderId)]);

// Confirmed memos only; the in-progress text lives in memo_drafts until Save.
export const memos = sqliteTable('memos', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), title: text('title').notNull().default(''),
  content: text('content').notNull(), createdAt: integer('created_at').notNull(), savedAt: integer('saved_at').notNull(),
  // Set when moved to the trash; the row is only removed when the trash is emptied.
  trashedAt: integer('trashed_at'),
}, (t) => [index('idx_memos_owner_saved').on(t.owner, t.savedAt)]);

// One autosaved draft per account so any signed-in device resumes the same text.
export const memoDrafts = sqliteTable('memo_drafts', {
  owner: text('owner').primaryKey(), memoId: text('memo_id').notNull(), title: text('title').notNull().default(''),
  content: text('content').notNull(), updatedAt: integer('updated_at').notNull(),
});

// Files and folders the person creates on the desktop; a null parent means the desktop itself.
// Trash keeps the row (trashed_at) so restore can return it to parent_id; only purge deletes it.
export const userFiles = sqliteTable('user_files', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), parentId: text('parent_id'),
  kind: text('kind').notNull(), name: text('name').notNull(), content: text('content').notNull().default(''),
  createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(), trashedAt: integer('trashed_at'),
  lockHash: text('lock_hash'), lockSalt: text('lock_salt'),
  lockFailures: integer('lock_failures').notNull().default(0), lockRetryAt: integer('lock_retry_at').notNull().default(0),
}, (t) => [index('idx_user_files_owner_parent').on(t.owner, t.parentId)]);

// What the desktop shows: fixed programs, user shortcuts, and desktop-level files. Hiding or
// renaming here never touches the program or file it points to.
export const desktopItems = sqliteTable('desktop_items', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(), target: text('target').notNull(),
  label: text('label'), icon: text('icon'), hidden: integer('hidden').notNull().default(0),
  sort: integer('sort').notNull(), createdAt: integer('created_at').notNull(),
}, (t) => [index('idx_desktop_items_owner').on(t.owner)]);

export const desktopSettings = sqliteTable('desktop_settings', {
  owner: text('owner').primaryKey(), wallpaperAssetId: text('wallpaper_asset_id'),
  wallpaperFit: text('wallpaper_fit').notNull().default('cover'), updatedAt: integer('updated_at').notNull(),
  // Chosen font id from the built-in list; null keeps the default font.
  font: text('font'),
});

// Uploaded wallpaper and icon images; the bytes live in R2.
export const desktopAssets = sqliteTable('desktop_assets', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), kind: text('kind').notNull(),
  objectKey: text('object_key').notNull(), mime: text('mime').notNull(), createdAt: integer('created_at').notNull(),
}, (t) => [index('idx_desktop_assets_owner').on(t.owner)]);

// Short-lived proof that a locked file was opened with its password; only a hash of the token is kept.
export const fileUnlocks = sqliteTable('file_unlocks', {
  tokenHash: text('token_hash').primaryKey(), owner: text('owner').notNull(), fileId: text('file_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
}, (t) => [index('idx_file_unlocks_owner_file').on(t.owner, t.fileId)]);

// Saved window arrangements only (which windows, where, how big). They never hold app data,
// so opening one shows today's memos, files and price lists.
export const workCapsules = sqliteTable('work_capsules', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), name: text('name').notNull(),
  layout: text('layout').notNull(), createdAt: integer('created_at').notNull(), updatedAt: integer('updated_at').notNull(),
  trashedAt: integer('trashed_at'),
}, (t) => [index('idx_work_capsules_owner').on(t.owner)]);
