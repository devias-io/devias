/**
 * The words the API uses for the text of a thing, and what each is for (see "Names, labels and titles" in
 * docs/build-a-module/manifest.mdx):
 * - `api`: an API name, what code calls a part (`name`, `nameSingular`, `namePlural`); never shown as text;
 * - `party`: what a member, workspace, API key, agent, module or publisher is called (`name`);
 * - `label`: the text people read for a part of the model or the interface;
 * - `title`: the text of a page of work: a document, comment, task, conversation, notification or workflow.
 */
export type Role = 'api' | 'party' | 'label' | 'title';

/** `Shape.path` of every property of the served API document that holds one of the words, by what it is for. */
export type Vocabulary = Record<Role, readonly string[]>;

const WORDS: Record<string, readonly Role[]> = {
  name: ['api', 'party'],
  nameSingular: ['api'],
  namePlural: ['api'],
  label: ['label'],
  labelSingular: ['label'],
  labelPlural: ['label'],
  title: ['title'],
};
const FORBIDDEN = ['displayName', 'heading', 'caption'];

export const RULE =
  '`name` is an API name or what a party is called, `label` is the text people read for a part of the model or the interface, `title` is the text of a page of work (docs/build-a-module/manifest.mdx, "Names, labels and titles")';

interface Found {
  at: string;
  word: string;
  required: boolean;
}

type Node = {
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
  additionalProperties?: Node | boolean;
  anyOf?: Node[];
  oneOf?: Node[];
  allOf?: Node[];
};

/** Every property named like one of the words, in every shape of an OpenAPI document (nested objects included). */
export const wordsIn = (document: { components?: { schemas?: Record<string, unknown> } }): Found[] => {
  const found: Found[] = [];
  const known = new Set([...Object.keys(WORDS), ...FORBIDDEN]);
  const walk = (node: Node | undefined, shape: string, path: string, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 10) {
      return;
    }

    for (const [key, child] of Object.entries(node.properties ?? {})) {
      const here = path ? `${path}.${key}` : key;

      if (known.has(key)) {
        found.push({ at: `${shape}.${here}`, word: key, required: node.required?.includes(key) ?? false });
      }

      walk(child, shape, here, depth + 1);
    }

    if (node.items) {
      walk(node.items, shape, `${path}[]`, depth + 1);
    }

    if (typeof node.additionalProperties === 'object') {
      walk(node.additionalProperties, shape, `${path}[]`, depth + 1);
    }

    for (const branch of [...(node.anyOf ?? []), ...(node.oneOf ?? []), ...(node.allOf ?? [])]) {
      walk(branch, shape, path, depth + 1);
    }
  };

  for (const [shape, schema] of Object.entries(document.components?.schemas ?? {})) {
    walk(schema as Node, shape, '', 0);
  }

  const seen = new Set<string>();

  return found.filter((one) => !seen.has(one.at) && seen.add(one.at));
};

export interface VocabularyOptions {
  /** Labels that may be left out, each with one fixed meaning (a heading that is not drawn, a default the schema names). */
  optionalLabels: readonly string[];
}

/** What is wrong with the words an API document uses: each problem is a sentence that says what to decide. */
export const vocabularyProblems = (
  document: { components?: { schemas?: Record<string, unknown> } },
  vocabulary: Vocabulary,
  options: VocabularyOptions,
): string[] => {
  const problems: string[] = [];
  const roles = new Map<string, Role>();

  for (const role of Object.keys(vocabulary) as Role[]) {
    for (const at of vocabulary[role]) {
      roles.set(at, role);
    }
  }

  const found = wordsIn(document);
  const present = new Set(found.map((one) => one.at));

  for (const one of found) {
    if (FORBIDDEN.includes(one.word)) {
      problems.push(`${one.at}: \`${one.word}\` is not one of the words. ${RULE}`);
      continue;
    }

    const role = roles.get(one.at);

    if (!role) {
      problems.push(
        `${one.at} uses \`${one.word}\` and is not in the vocabulary table: add it with what it is for. ${RULE}`,
      );
      continue;
    }

    if (!WORDS[one.word]?.includes(role)) {
      problems.push(`${one.at} is a ${role} but says \`${one.word}\`. ${RULE}`);
    }

    if (role === 'label' && !one.required && !options.optionalLabels.includes(one.at)) {
      problems.push(
        `${one.at} is an optional label: a label is required unless leaving it out has one fixed meaning (see D4)`,
      );
    }
  }

  // The two jobs of `name` never share a shape: next to a label it is an API name.
  const containers = new Map<string, { party: boolean; label: boolean }>();

  for (const one of found) {
    const role = roles.get(one.at);
    const container = one.at.slice(0, one.at.length - one.word.length);
    const state = containers.get(container) ?? { party: false, label: false };

    state.party ||= role === 'party';
    state.label ||= role === 'label';
    containers.set(container, state);
  }

  for (const [container, state] of containers) {
    if (state.party && state.label) {
      problems.push(`${container || 'a shape'} has a party's name beside a label: ${RULE}`);
    }
  }

  const unknownAt = Object.entries(vocabulary).flatMap(([role, list]) =>
    list.filter((at) => !present.has(at)).map((at) => `${at} (${role})`),
  );

  for (const at of unknownAt) {
    problems.push(`${at} is in the vocabulary table but not in the API document: remove it or fix its name`);
  }

  return problems;
};
