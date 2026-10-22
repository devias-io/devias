/**
 * AI tables, one file per area (each is one migration). Same conventions as the engine schema: snake_case columns
 * through `casing`, uuid v7 ids generated in application code, workspace ids as text, no foreign keys into auth tables.
 * Conversations are owned by one user and are with one of the workspace's agents; a turn is one user message and
 * everything the agent did in response.
 */
export * from './agents';
export * from './conversations';
export * from './runs';
export * from './settings';
