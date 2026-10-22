import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const env = (overrides: Record<string, string> = {}) => ({
  BETTER_AUTH_SECRET: 'x'.repeat(40),
  ...overrides,
});

describe('AI provider configuration', () => {
  it('defaults to Anthropic and says what is missing', () => {
    const config = loadConfig(env());

    expect(config.ai).toMatchObject({ provider: 'anthropic', apiKey: undefined, model: 'claude-opus-5' });
    expect(config.warnings.some((warning) => warning.includes('ANTHROPIC_API_KEY is not set'))).toBe(true);
  });

  it('reads the key, endpoint and default model of the chosen provider', () => {
    const google = loadConfig(
      env({ AI_PROVIDER: 'google', GEMINI_API_KEY: 'g-key', GEMINI_BASE_URL: 'https://g.test' }),
    );
    const openai = loadConfig(env({ AI_PROVIDER: 'openai', OPENAI_API_KEY: 'o-key', AI_MODEL: 'gpt-5-mini' }));

    expect(google.ai).toMatchObject({
      provider: 'google',
      apiKey: 'g-key',
      baseUrl: 'https://g.test',
      model: 'gemini-2.5-pro',
    });
    expect(openai.ai).toMatchObject({ provider: 'openai', apiKey: 'o-key', baseUrl: undefined, model: 'gpt-5-mini' });
  });

  it('ignores the keys of the other providers', () => {
    const config = loadConfig(env({ AI_PROVIDER: 'openai', ANTHROPIC_API_KEY: 'a-key', GEMINI_API_KEY: 'g-key' }));

    expect(config.ai.apiKey).toBeUndefined();
    expect(config.warnings.some((warning) => warning.includes('OPENAI_API_KEY is not set'))).toBe(true);
  });

  it('accepts the SDK’s own name for the Gemini key, and refuses an unknown provider', () => {
    expect(loadConfig(env({ AI_PROVIDER: 'google', GOOGLE_GENERATIVE_AI_API_KEY: 'sdk-key' })).ai.apiKey).toBe(
      'sdk-key',
    );
    expect(() => loadConfig(env({ AI_PROVIDER: 'mistral' }))).toThrow();
  });
});
