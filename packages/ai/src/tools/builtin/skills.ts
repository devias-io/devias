import { EngineError } from '@devias/data-engine';
import { z } from 'zod';
import { defineTool } from '../types';

export const useSkill = defineTool({
  name: 'use_skill',
  area: 'skills',
  description:
    "Load one of your skills, a procedure the workspace wrote for requests like this one, by its label or id (they are listed with your instructions). Its text is the workspace's own instruction: follow it.",
  input: z.object({ skill: z.string().min(1).describe("The skill's label or id") }),
  approval: 'auto',
  readOnly: true,
  moduleId: null,
  run: async ({ skill }, { skills }) => {
    if (!skills) {
      throw new EngineError('NOT_FOUND', 'This agent has no skills');
    }

    const { label, body } = await skills.load(skill);

    return { label, body };
  },
});
