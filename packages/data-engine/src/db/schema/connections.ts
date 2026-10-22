import { index, jsonb, pgTable, primaryKey, text, unique, uuid } from 'drizzle-orm/pg-core';
import { timestamptz } from './columns';

/** How modules reach outside services: connections, workspace variables and OAuth state. */

/**
 * A connection of one installed module to its outside service: an API key typed once (`api_key`) or an account a person
 * agreed to share (`oauth2`). It belongs to the workspace (`owner_user_id` null) or to one person. Credentials are
 * sealed with the engine's secret box (`modules/secret-box.ts`); hints are masked previews for display. A random
 * webhook token forms the URL the outside service posts its events to.
 */
export const moduleConnection = pgTable(
  'module_connection',
  {
    id: uuid().primaryKey(),
    workspaceId: text().notNull(),
    moduleId: text().notNull(),
    /** The manifest's provider id (`default`, `google`). */
    providerId: text().notNull(),
    kind: text().notNull(),
    /** `user` or `workspace`. */
    visibility: text().notNull(),
    ownerUserId: text(),
    label: text(),
    /** Who it is connected as at the outside service: an email, an account id. */
    account: text(),
    /** Sealed JSON: an API key connection's values by field key, or an OAuth connection's tokens. Never selected for API responses. */
    sealed: text().notNull(),
    hints: jsonb().$type<Record<string, string>>().notNull().default({}),
    scopes: jsonb().$type<string[]>().notNull().default([]),
    /** When an OAuth access token runs out. */
    expiresAt: timestamptz(),
    /** `connected` or `auth_failed` (the outside service refused the credentials; `lastError` says why). */
    status: text().notNull().default('connected'),
    authFailedAt: timestamptz(),
    lastError: text(),
    lastTestedAt: timestamptz(),
    lastUsedAt: timestamptz(),
    /** Random path segment of the webhook URL; null for modules without events. */
    webhookToken: text(),
    createdBy: text(),
    createdAt: timestamptz().notNull().defaultNow(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [
    unique('module_connection_owner_account_uq')
      .on(t.workspaceId, t.moduleId, t.providerId, t.ownerUserId, t.account)
      .nullsNotDistinct(),
    unique('module_connection_webhook_token_uq').on(t.webhookToken),
    index('module_connection_ws_module_idx').on(t.workspaceId, t.moduleId),
  ],
);

/** A workspace's value of one of a module's workspace variables (plain configuration, never a secret). */
export const moduleVariable = pgTable(
  'module_variable',
  {
    workspaceId: text().notNull(),
    moduleId: text().notNull(),
    key: text().notNull(),
    value: text().notNull(),
    updatedBy: text(),
    updatedAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.moduleId, t.key] })],
);

/**
 * An OAuth consent in progress: the random `state` the provider hands back to the callback, who started it and where
 * to, and the sealed PKCE verifier. Used once; expires after ten minutes.
 */
export const oauthState = pgTable(
  'oauth_state',
  {
    state: text().primaryKey(),
    workspaceId: text().notNull(),
    userId: text().notNull(),
    moduleId: text().notNull(),
    providerId: text().notNull(),
    visibility: text().notNull(),
    codeVerifier: text(),
    returnTo: text(),
    expiresAt: timestamptz().notNull(),
    createdAt: timestamptz().notNull().defaultNow(),
  },
  (t) => [index('oauth_state_expires_idx').on(t.expiresAt)],
);
