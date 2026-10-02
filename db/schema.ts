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
}, (t) => [index('idx_price_images_owner_folder').on(t.owner, t.folderId)]);

// Confirmed memos only; the in-progress text lives in memo_drafts until Save.
export const memos = sqliteTable('memos', {
  id: text('id').primaryKey(), owner: text('owner').notNull(), title: text('title').notNull().default(''),
  content: text('content').notNull(), createdAt: integer('created_at').notNull(), savedAt: integer('saved_at').notNull(),
}, (t) => [index('idx_memos_owner_saved').on(t.owner, t.savedAt)]);

// One autosaved draft per account so any signed-in device resumes the same text.
export const memoDrafts = sqliteTable('memo_drafts', {
  owner: text('owner').primaryKey(), memoId: text('memo_id').notNull(), title: text('title').notNull().default(''),
  content: text('content').notNull(), updatedAt: integer('updated_at').notNull(),
});
