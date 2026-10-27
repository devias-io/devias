import { EngineError } from '@devias/data-engine';
import type { AiStore, SkillRow } from './store';
import type { SkillsPort } from './tools/types';

/** The skills an agent may use of the active ones: the ids it names, or all of them when it names none. */
export const skillsOf = (active: readonly SkillRow[], allowed: ReadonlySet<string> | null): SkillRow[] =>
  allowed ? active.filter((skill) => allowed.has(skill.id)) : [...active];

/**
 * The agent's skills as a tool loads them. The list is read when a skill is loaded, so a skill archived since the
 * turn began is refused, and a skill added for an agent that may use every one is found at once.
 */
export const createSkillsPort = (
  store: AiStore,
  workspaceId: string,
  allowed: ReadonlySet<string> | null,
): SkillsPort => ({
  load: async (ref) => {
    const mine = skillsOf(await store.skills.list(workspaceId), allowed);
    const needle = ref.trim().toLowerCase();
    const byId = mine.find((skill) => skill.id === ref.trim());
    const found = byId ? [byId] : mine.filter((skill) => skill.label.toLowerCase() === needle);

    if (found.length === 0) {
      const labels = mine.map((skill) => skill.label).join(', ');

      throw new EngineError('NOT_FOUND', `No skill "${ref}". Your skills: ${labels || 'none'}`);
    }

    if (found.length > 1) {
      throw new EngineError(
        'CONFLICT',
        `${found.length} skills are called "${ref}": use an id (${found.map((skill) => skill.id).join(', ')})`,
      );
    }

    const [skill] = found as [SkillRow];

    return { id: skill.id, label: skill.label, body: skill.body };
  },
});

/**
 * What an agent is told of its skills: when to load one, then each label and the line saying when it is for. Sorted by
 * label so the text is the same from turn to turn. A label that two skills share carries its id.
 */
export const skillsBlock = (skills: readonly SkillRow[]): string => {
  if (skills.length === 0) {
    return '';
  }

  const sorted = [...skills].sort((a, b) => a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
  const shared = (skill: SkillRow) =>
    sorted.filter((other) => other.label.toLowerCase() === skill.label.toLowerCase()).length > 1;

  return [
    '## Skills',
    'Procedures the workspace wrote for requests like these. When a request matches one, load it with use_skill and follow it.',
    ...sorted.map((skill) => `- ${skill.label}${shared(skill) ? ` [${skill.id}]` : ''}: ${skill.description}`),
  ].join('\n');
};
