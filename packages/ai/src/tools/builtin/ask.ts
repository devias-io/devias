import { z } from 'zod';
import { defineTool } from '../types';

const OptionSchema = z.object({
  label: z.string().trim().min(1).max(80).describe('What the person reads and what comes back as the answer'),
  description: z.string().trim().max(200).optional().describe('One short line that helps choose'),
});

/**
 * A question for the person, with options when there are a few good answers. The call always waits for them,
 * whatever its approval mode, and their answer comes back as the result: unlike a secret, it is for the agent.
 */
export const askUser = defineTool({
  name: 'ask_user',
  area: 'conversation',
  description:
    'Ask the person one question and wait for the answer, instead of guessing or asking in free text. Give 2 to 6 options when there are a few good answers (they pick one, and may type their own unless allowOther is false); give none for an open question. The result is { answer }. If the person skips it, carry on without the answer or stop; do not ask again. Ask only what you cannot find out with your tools.',
  input: z.object({
    question: z.string().trim().min(1).max(300).describe('One short question'),
    options: z.array(OptionSchema).min(2).max(6).optional(),
    allowOther: z
      .boolean()
      .optional()
      .describe('Let the person type an answer of their own besides the options (default true)'),
  }),
  approval: 'auto',
  // It changes nothing, so it stays available after outside content was read.
  readOnly: true,
  moduleId: null,
  requestInput: async ({ question, options, allowOther }) => ({
    title: question,
    fields: [{ name: 'answer', label: 'Your answer', secret: false, required: true }],
    question: {
      options: (options ?? []).map(({ label, description }) => ({
        value: label,
        label,
        ...(description ? { description } : {}),
      })),
      other: options ? (allowOther ?? true) : true,
    },
  }),
  run: async (_input, { secrets }) => ({ answer: secrets?.answer ?? '' }),
});
