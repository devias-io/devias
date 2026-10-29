import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** Stored files. */

/**
 * A stored file: bytes that never change, and what a workspace or a person calls them. The bytes live in the file
 * store under `storage_key` (a prefix: the original and its variants are objects beneath it); this row says what they
 * are. `content_type` is detected from the bytes, never taken from the client. `kind` says what the file is for:
 * `asset` is an entry of a workspace's library (what people and agents manage, link to and list), `logo` is a
 * workspace's logo and `avatar` a person's picture, which no library lists. A `public` file is opened by anyone who has its
 * link, which is the same for ever (what `user.image` and `organization.logo` hold); a private one is opened only through a
 * signed link or by someone who may read it. Avatars and logos are added public, assets private. A file with no `workspace_id` belongs to a
 * person: it is an avatar and its creator is a user. `name`, `description` and `version` (counting writes to them, for
 * edits made from a stale copy) are what a person edits; for an avatar or a logo they are only the original file name.
 * Removed files stay (soft delete) as tombstones, so what referred to one reads "file removed" instead of missing;
 * their bytes are gone or about to be.
 */
export const file = pgTable(
  'file',
  {
    id: uuid().primaryKey(),
    workspaceId: text(),
    kind: text().notNull().default('asset'),
    public: boolean().notNull().default(false),
    name: text().notNull(),
    description: text().notNull().default(''),
    contentType: text().notNull(),
    size: bigint({ mode: 'number' }).notNull(),
    checksum: text().notNull(),
    storageKey: text().notNull(),
    width: integer(),
    height: integer(),
    version: integer().notNull().default(1),
    createdBy: jsonb().$type<{ kind: string; id: string }>().notNull(),
    updatedBy: jsonb().$type<{ kind: string; id: string }>().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
    deletedAt: timestamptz(),
  },
  (t) => [
    check('file_kind_check', sql`${t.kind} in ('asset', 'logo', 'avatar')`),
    check(
      'file_owner_check',
      sql`${t.workspaceId} is not null or (${t.kind} = 'avatar' and ${t.createdBy}->>'kind' = 'user')`,
    ),
    index('file_library_idx')
      .on(t.workspaceId, t.updatedAt.desc(), t.id.desc())
      .where(sql`${t.deletedAt} is null and ${t.kind} = 'asset'`),
    index('file_ws_checksum_idx').on(t.workspaceId, t.checksum),
  ],
);
