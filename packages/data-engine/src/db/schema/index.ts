/**
 * Engine tables, one file per area (each is one migration). Column names derive from property names with
 * `casing: 'snake_case'` (both in `drizzle.config.ts` and at runtime). Workspace ids are text because Better Auth
 * organization ids are text; engine ids are uuid v7 generated in application code. No foreign keys point at auth tables.
 */

export * from './comments';
export * from './connections';
export * from './data-model';
export * from './documents';
export * from './events';
export * from './files';
export * from './interface';
export * from './kv';
export * from './mentions';
export * from './modules';
export * from './notifications';
export * from './records';
export * from './tasks';
export * from './workflows';
export * from './workspace';
