import { describe, expect, it } from 'vitest';
import { DEFAULT_SUGGESTED_PROMPTS, SUGGESTED_PROMPT_MAX_LENGTH, SUGGESTED_PROMPTS_MAX } from '../src';

describe('default suggestions', () => {
  it('name no object or module, since a workspace may have none of them', () => {
    const named =
      /\b(deals?|companies|company|people|person|contacts?|tasks?|quotes?|invoices?|products?|documents?|notes?|expenses?|leads?)\b/i;

    for (const prompt of DEFAULT_SUGGESTED_PROMPTS) {
      expect(prompt, prompt).not.toMatch(named);
    }
  });

  it('fit the limits a workspace has to keep to for its own', () => {
    expect(DEFAULT_SUGGESTED_PROMPTS.length).toBeLessThanOrEqual(SUGGESTED_PROMPTS_MAX);

    for (const prompt of DEFAULT_SUGGESTED_PROMPTS) {
      expect(prompt.length).toBeLessThanOrEqual(SUGGESTED_PROMPT_MAX_LENGTH);
    }
  });
});
