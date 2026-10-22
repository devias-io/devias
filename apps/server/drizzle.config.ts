import { defineConfig } from 'drizzle-kit';

/**
 * Migrations cover the engine tables (@devias/data-engine), the AI tables (@devias/ai) and Better Auth. Each schema
 * file of the first two is one area and one migration (see docs/operations/database.mdx).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: [
    '../../packages/data-engine/src/db/schema/index.ts',
    '../../packages/ai/src/db/schema/index.ts',
    './src/db/schema/auth.ts',
  ],
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgres://localhost:5432/devias' },
});
