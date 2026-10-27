import { createAiSdkModelClient } from './ai-sdk';
import { createAnthropicModelClient } from './anthropic';
import type { ModelClient } from './types';

export const MODEL_PROVIDERS = ['anthropic', 'google', 'openai'] as const;
export type ModelProvider = (typeof MODEL_PROVIDERS)[number];

/** What a provider runs when `AI_MODEL` is not set. */
export const DEFAULT_MODELS: Record<ModelProvider, string> = {
  anthropic: 'claude-opus-5',
  google: 'gemini-2.5-pro',
  openai: 'gpt-5',
};

export interface ModelClientOptions {
  provider: ModelProvider;
  apiKey: string;
  model: string;
  effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
  maxTokens: number;
  /** Server-side refusal fallbacks; Anthropic only. */
  fallbacks: boolean;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** A different endpoint for the provider. */
  baseURL?: string;
}

/** The model client for the configured provider. */
export const createModelClient = (options: ModelClientOptions): ModelClient => {
  const { provider, fallbacks, ...rest } = options;

  return provider === 'anthropic'
    ? createAnthropicModelClient({ ...rest, fallbacks })
    : createAiSdkModelClient({ ...rest, provider });
};
