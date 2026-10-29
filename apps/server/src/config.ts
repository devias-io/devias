import { DEFAULT_MODELS, MODEL_PROVIDERS, type ModelProvider } from '@devias/ai';
import { ASSET_LINK_MAX_TTL_SECONDS, FILE_MAX_BYTES_DEFAULT } from '@devias/core';
import { DEFAULT_FILE_URL_BUCKET_SECONDS } from '@devias/data-engine';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1).optional(),
  PGLITE_DATA_DIR: z.string().min(1).default('./.data/pglite'),
  BETTER_AUTH_SECRET: z.string().min(1).optional(),
  ENCRYPTION_KEY: z.string().min(16).optional(),
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  STUDIO_ORIGIN: z.url().default('http://localhost:5173'),
  // "Continue with Google" on the sign-in page switches on when both are set
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MIGRATE_ON_BOOT: bool.optional(),
  // Files: where their bytes are kept, and the limits on them
  FILES_DIR: z.string().min(1).default('./.data/files'),
  FILE_MAX_BYTES: z.coerce.number().int().positive().default(FILE_MAX_BYTES_DEFAULT),
  FILE_WORKSPACE_QUOTA_BYTES: z.coerce.number().int().positive().optional(),
  FILE_URL_BUCKET_SECONDS: z.coerce.number().int().min(60).default(DEFAULT_FILE_URL_BUCKET_SECONDS),
  FILE_LINK_MAX_TTL_SECONDS: z.coerce.number().int().min(60).default(ASSET_LINK_MAX_TTL_SECONDS),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  // AI: one provider at a time, with its own key
  AI_PROVIDER: z.enum(MODEL_PROVIDERS).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_BASE_URL: z.url().optional(),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
  GEMINI_BASE_URL: z.url().optional(),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_BASE_URL: z.url().optional(),
  /** Defaults to a model of the provider. */
  AI_MODEL: z.string().min(1).optional(),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('high'),
  AI_MAX_TOKENS: z.coerce.number().int().positive().default(16_000),
  AI_MAX_ITERATIONS: z.coerce.number().int().positive().default(12),
  AI_FALLBACKS: bool.default(true),
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
});

export const DEV_SECRET = 'dev-secret-change-me-before-going-anywhere-near-production';

export interface ServerConfig {
  port: number;
  databaseUrl: string | undefined;
  pgliteDataDir: string;
  authSecret: string;
  /** Seals module connections' credentials at rest; derived from the auth secret when not set. */
  encryptionKey: string;
  authUrl: string;
  studioOrigin: string;
  /** Sign-in with Google, when its client is set; the redirect URI to register is `<authUrl>/api/auth/callback/google`. */
  google: { clientId: string; clientSecret: string } | undefined;
  migrateOnBoot: boolean;
  files: FilesConfig;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
  ai: AiConfig;
  warnings: string[];
}

/** Where files are kept and how much of them there may be. */
export interface FilesConfig {
  /** The folder the bytes live in; back it up together with the database. */
  dir: string;
  /** The largest file. */
  maxBytes: number;
  /** The most one workspace may store; null while unlimited. */
  quotaBytes: number | null;
  /** Links embedded in pages stay the same for this long, so browsers keep the files. */
  urlBucketSeconds: number;
  /** The longest a link a person asks for may last. */
  linkMaxTtlSeconds: number;
}

export interface AiConfig {
  provider: ModelProvider;
  /** The provider's key; missing = AI disabled (status reports `configured: false`). */
  apiKey: string | undefined;
  baseUrl: string | undefined;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  maxIterations: number;
  /** Server-side refusal fallbacks (`fallbacks: "default"`); Anthropic only. */
  fallbacks: boolean;
  requestTimeoutMs: number;
}

/** Parse configuration from an env-like object; missing secrets fall back to a dev value with a warning. */
export const loadConfig = (env: Record<string, string | undefined> = process.env): ServerConfig => {
  const parsed = EnvSchema.parse(env);
  const warnings: string[] = [];
  let authSecret = parsed.BETTER_AUTH_SECRET;

  if (!authSecret) {
    authSecret = DEV_SECRET;
    warnings.push('BETTER_AUTH_SECRET is not set; using an insecure development secret');
  }

  let encryptionKey = parsed.ENCRYPTION_KEY;

  if (!encryptionKey) {
    encryptionKey = `${authSecret}:module-settings`;
    warnings.push(
      'ENCRYPTION_KEY is not set; module connections are encrypted with a key derived from the auth secret',
    );
  }

  const usingPglite = !parsed.DATABASE_URL;

  const provider = parsed.AI_PROVIDER;
  const keyVariable = { anthropic: 'ANTHROPIC_API_KEY', google: 'GEMINI_API_KEY', openai: 'OPENAI_API_KEY' }[provider];
  const aiKey = {
    anthropic: parsed.ANTHROPIC_API_KEY,
    google: parsed.GEMINI_API_KEY ?? parsed.GOOGLE_GENERATIVE_AI_API_KEY,
    openai: parsed.OPENAI_API_KEY,
  }[provider];
  const aiBaseUrl = {
    anthropic: parsed.ANTHROPIC_BASE_URL,
    google: parsed.GEMINI_BASE_URL,
    openai: parsed.OPENAI_BASE_URL,
  }[provider];

  if (!aiKey) {
    warnings.push(`${keyVariable} is not set; AI is disabled (AI_PROVIDER is ${provider})`);
  }

  return {
    port: parsed.PORT,
    databaseUrl: parsed.DATABASE_URL,
    pgliteDataDir: parsed.PGLITE_DATA_DIR,
    authSecret,
    encryptionKey,
    authUrl: parsed.BETTER_AUTH_URL,
    studioOrigin: parsed.STUDIO_ORIGIN,
    google:
      parsed.GOOGLE_CLIENT_ID && parsed.GOOGLE_CLIENT_SECRET
        ? { clientId: parsed.GOOGLE_CLIENT_ID, clientSecret: parsed.GOOGLE_CLIENT_SECRET }
        : undefined,
    migrateOnBoot: parsed.MIGRATE_ON_BOOT ?? usingPglite,
    files: {
      dir: parsed.FILES_DIR,
      maxBytes: parsed.FILE_MAX_BYTES,
      quotaBytes: parsed.FILE_WORKSPACE_QUOTA_BYTES ?? null,
      urlBucketSeconds: parsed.FILE_URL_BUCKET_SECONDS,
      linkMaxTtlSeconds: parsed.FILE_LINK_MAX_TTL_SECONDS,
    },
    logLevel: parsed.LOG_LEVEL,
    ai: {
      provider,
      apiKey: aiKey,
      baseUrl: aiBaseUrl,
      model: parsed.AI_MODEL ?? DEFAULT_MODELS[provider],
      effort: parsed.AI_EFFORT,
      maxTokens: parsed.AI_MAX_TOKENS,
      maxIterations: parsed.AI_MAX_ITERATIONS,
      fallbacks: parsed.AI_FALLBACKS,
      requestTimeoutMs: parsed.AI_REQUEST_TIMEOUT_MS,
    },
    warnings,
  };
};
