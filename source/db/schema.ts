// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
export const workspaces = sqliteTable('workspaces', {
  ownerId: text('owner_id').primaryKey(),
  version: integer('version').notNull().default(1),
  data: text('data').notNull(),
  updatedAt: text('updated_at').notNull(),
});
