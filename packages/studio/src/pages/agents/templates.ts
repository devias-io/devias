import type { AiAgentInput, AiToolInfo } from '@devias/core';

/**
 * A starting point for a new agent. A template is a pure function of the tool catalog that returns the same shape
 * creating an agent takes, so one could come from somewhere else (a module's definition) with no change to the editor.
 */
export interface AgentTemplate {
  key: string;
  title: string;
  description: string;
  icon: string;
  build: (tools: readonly AiToolInfo[]) => AiAgentInput;
}

export const AGENT_TEMPLATES: readonly AgentTemplate[] = [
  {
    key: 'blank',
    title: 'Blank',
    description: 'Start from nothing and pick everything yourself.',
    icon: 'plus',
    build: () => ({ name: '', tools: null }),
  },
  {
    key: 'analyst',
    title: 'Read-only analyst',
    description: 'Looks things up and answers questions; cannot change anything.',
    icon: 'chart-bar',
    build: (tools) => ({
      name: 'Analyst',
      icon: 'chart-bar',
      description: 'Answers questions about your data without changing it.',
      instructions:
        'You only read. Look up records, counts and workflows, and explain what you find. When asked to change something, say that you cannot and what the person can do instead.',
      tools: tools.filter((tool) => tool.readOnly).map((tool) => tool.name),
      starterPrompts: ['see how many records I have in each object', 'find what was created or changed today'],
    }),
  },
  {
    key: 'general',
    title: 'General',
    description: 'Every tool the person may use, including ones added later.',
    icon: 'agent',
    build: () => ({
      name: 'General',
      icon: 'agent',
      description: 'Works with everything in the workspace.',
      tools: null,
    }),
  },
];

export const templateOf = (key: unknown): AgentTemplate | undefined =>
  AGENT_TEMPLATES.find((template) => template.key === key);
