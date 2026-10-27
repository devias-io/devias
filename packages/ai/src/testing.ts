import { type AiUsage, addUsage, emptyUsage } from '@devias/core';
import {
  type ContentBlock,
  isTextBlock,
  isThinkingBlock,
  isToolUseBlock,
  type ModelClient,
  ModelError,
  type ModelRequest,
  type ModelResult,
} from './model/types';

/**
 * A scripted model for tests: every `stream` call pops the next scripted message and replays it as
 * the same event sequence the real adapter produces. Requests are recorded for assertions.
 */

export interface ScriptedMessage {
  content: ContentBlock[] | string;
  stopReason?: string | null;
  model?: string;
  usage?: Partial<AiUsage>;
  /** Throw instead of answering. */
  error?: ModelError;
}

export type ScriptStep = ScriptedMessage | ((request: ModelRequest, index: number) => ScriptedMessage);

export interface FakeModelClient extends ModelClient {
  requests: ModelRequest[];
  /** Append steps after construction. */
  push(...steps: ScriptStep[]): void;
  remaining(): number;
}

export const text = (value: string): ContentBlock => ({ type: 'text', text: value });
export const thinking = (value: string, signature = 'sig'): ContentBlock => ({
  type: 'thinking',
  thinking: value,
  signature,
});
let toolUseCounter = 0;
export const toolUse = (name: string, input: unknown, id?: string): ContentBlock => ({
  type: 'tool_use',
  id: id ?? `toolu_${String(++toolUseCounter).padStart(4, '0')}`,
  name,
  input,
});

const splitText = (value: string): string[] => {
  if (value.length < 8) {
    return [value];
  }

  const middle = Math.floor(value.length / 2);

  return [value.slice(0, middle), value.slice(middle)];
};

export const createFakeModelClient = (
  script: ScriptStep[] = [],
  options: { model?: string; effort?: string; delayMs?: number } = {},
): FakeModelClient => {
  const steps = [...script];
  const requests: ModelRequest[] = [];
  const model = options.model ?? 'fake-model';
  const delay = options.delayMs ?? 0;
  const wait = () => (delay > 0 ? new Promise<void>((resolve) => setTimeout(resolve, delay)) : undefined);

  return {
    model,
    effort: options.effort ?? 'high',
    requests,
    push: (...more) => {
      steps.push(...more);
    },
    remaining: () => steps.length,
    stream: async (request, onEvent) => {
      requests.push(request);
      const step = steps.shift();

      if (!step) {
        throw new ModelError('INTERNAL', 'The fake model has no scripted reply left', false);
      }

      const scripted = typeof step === 'function' ? step(request, requests.length - 1) : step;

      if (scripted.error) {
        throw scripted.error;
      }

      const content: ContentBlock[] =
        typeof scripted.content === 'string' ? [text(scripted.content)] : scripted.content;
      const stopReason =
        scripted.stopReason === undefined
          ? content.some(isToolUseBlock)
            ? 'tool_use'
            : 'end_turn'
          : scripted.stopReason;
      const usage = addUsage(emptyUsage(), { inputTokens: 100, outputTokens: 20, ...scripted.usage });
      const id = `msg_${String(requests.length).padStart(4, '0')}`;
      const assertAlive = () => {
        if (request.signal?.aborted) {
          throw new ModelError('ABORTED', 'The request was cancelled', false);
        }
      };

      assertAlive();
      onEvent({ type: 'message_start', id, model: scripted.model ?? model, usage: { ...usage, outputTokens: 0 } });

      for (const [index, block] of content.entries()) {
        await wait();
        assertAlive();

        if (isTextBlock(block)) {
          onEvent({ type: 'block_start', index, block: { type: 'text', text: '' } });

          for (const chunk of splitText(block.text)) {
            onEvent({ type: 'text_delta', index, text: chunk });
          }
        } else if (isThinkingBlock(block)) {
          onEvent({ type: 'block_start', index, block: { type: 'thinking', thinking: '', signature: '' } });
          onEvent({ type: 'thinking_delta', index, text: block.thinking });
        } else if (isToolUseBlock(block)) {
          onEvent({ type: 'block_start', index, block: { ...block, input: {} } });
          onEvent({ type: 'input_json_delta', index, partialJson: JSON.stringify(block.input) });
        } else {
          onEvent({ type: 'block_start', index, block });
        }

        onEvent({ type: 'block_stop', index });
      }

      onEvent({ type: 'message_delta', stopReason, usage: { outputTokens: usage.outputTokens } });
      onEvent({ type: 'message_stop' });
      const result: ModelResult = { id, model: scripted.model ?? model, content, stopReason, usage };

      return result;
    },
  };
};
