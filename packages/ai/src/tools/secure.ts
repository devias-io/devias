import { type InputRequest, type RevealedValue, settingsProblem } from '@devias/core';
import { EngineError } from '@devias/data-engine';

/**
 * Secrets travel between the person and the server, around the model: a tool asks for them with `requestInput`
 * (the card renders the fields, the answers come back with the approval) and hands new ones back with
 * `revealToPerson` (shown once on the live event). Neither is stored nor sent to the model.
 */

const REVEALED = Symbol('revealed');

interface Revealing {
  [REVEALED]: RevealedValue[];
  result: unknown;
}

/** A tool result for the model, plus values only the person sees, once. */
export const revealToPerson = (result: unknown, values: RevealedValue[]): unknown =>
  ({ [REVEALED]: values, result }) satisfies Revealing;

/** Split what a tool returned into what the model and the store get, and what only the person sees. */
export const splitRevealed = (raw: unknown): { result: unknown; revealed?: RevealedValue[] } =>
  raw !== null && typeof raw === 'object' && REVEALED in raw
    ? { result: (raw as Revealing).result, revealed: (raw as Revealing)[REVEALED] }
    : { result: raw };

/** Refuse answers that don't fit the request: unknown keys, or a required field left empty. */
export const checkAnswers = (
  request: InputRequest,
  values: Record<string, string> | undefined,
): Record<string, string> => {
  const answers = Object.fromEntries(Object.entries(values ?? {}).filter(([, value]) => value.trim() !== ''));
  const problem = settingsProblem(request.fields, answers);

  if (problem) {
    throw new EngineError('VALIDATION', problem.message, { path: `values.${problem.name}` });
  }

  // A question with options and no "other" takes one of the options, so a stray answer is refused and can be resent.
  const { question } = request;

  if (
    question &&
    question.options.length > 0 &&
    !question.other &&
    !question.options.some((o) => o.value === answers.answer)
  ) {
    throw new EngineError('VALIDATION', 'Choose one of the options', { path: 'values.answer' });
  }

  return answers;
};
