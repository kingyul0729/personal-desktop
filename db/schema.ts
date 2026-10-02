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
