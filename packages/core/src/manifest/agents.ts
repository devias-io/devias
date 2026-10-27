import { z } from 'zod';
import {
  MODULE_SKILLS_MAX,
  SKILL_BODY_MAX,
  SKILL_DESCRIPTION_MAX,
  SKILL_LABEL_MAX,
  SUGGESTED_PROMPTS_MAX,
  SuggestedPromptSchema,
} from '../ai';
import { IdSchema } from '../ids';

/**
 * An agent a module ships: instructions and the actions it may use for the module's own work (a sales agent for the CRM).
 * Installing the module gives the workspace the agent, updating the module updates it, uninstalling archives it.
 * `actionIds` lists action ids, at least one: a core action is `coreIds.actions.list_records`, the
 * agent's own `coreIds.actions.ask_user`, and a module's own action `ids.actions.recalculate_quote`. The agent calls the tool that
 * serves each. A module agent never has "every tool". It may not name an action whose tool reaches beyond its name
 * (workflows, keys, members, modules, agents), and an id no tool answers to is dropped when the agent is made.
 * `skillIds` names the skills of the module (`SkillDefinitionSchema`) the agent may use: a module's agent never has "every
 * skill".
 */
export const AgentDefinitionSchema = z
  .object({
    /** Stable across versions, so an update changes the agent instead of adding another. */
    id: IdSchema,
    label: z.string().trim().min(1).max(80),
    icon: z.string().max(64).optional(),
    description: z.string().max(500).optional(),
    instructions: z.string().max(20_000).optional(),
    actionIds: z.array(IdSchema).min(1).max(500),
    starterPrompts: z.array(SuggestedPromptSchema).max(SUGGESTED_PROMPTS_MAX).default([]),
    skillIds: z.array(IdSchema).max(MODULE_SKILLS_MAX).default([]),
  })
  .meta({ id: 'AgentDefinition' });
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;

/**
 * A skill a module ships: a procedure its agents (and any agent that may use every skill) load when a request calls for
 * it. Installing the module gives the workspace the skill, updating the module updates it, uninstalling archives it.
 */
export const SkillDefinitionSchema = z
  .object({
    /** Stable across versions, so an update changes the skill instead of adding another. */
    id: IdSchema,
    label: z.string().trim().min(1).max(SKILL_LABEL_MAX),
    /** One line saying when to use it. */
    description: z.string().trim().min(1).max(SKILL_DESCRIPTION_MAX),
    /** The procedure, as Markdown. */
    body: z.string().trim().min(1).max(SKILL_BODY_MAX),
  })
  .meta({ id: 'SkillDefinition' });
export type SkillDefinition = z.infer<typeof SkillDefinitionSchema>;
