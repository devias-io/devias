import type { AiToolArea, AiToolInfo } from '@devias/core';
import { describe, expect, it } from 'vitest';
import { groupTools } from '../src/pages/agents/tool-groups';

const tool = (name: string, area: AiToolArea): AiToolInfo => ({
  name,
  description: '',
  area,
  readOnly: false,
  escalates: false,
  approval: 'auto',
  locked: false,
  moduleId: null,
});

describe('grouping tools', () => {
  it('groups tools by their area, in the areas order and by title, leaving out empty areas', () => {
    const groups = groupTools([
      tool('run_workflow', 'workflows'),
      tool('update_record', 'records'),
      tool('create_record', 'records'),
      tool('create_field', 'model'),
    ]);
    expect(groups.map((group) => group.label)).toEqual(['Records', 'Data model', 'Workflows']);
    expect(groups[0]?.tools.map((t) => t.name)).toEqual(['create_record', 'update_record']);
  });
});
