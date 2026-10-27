import { AI_TOOL_AREAS, type AiToolArea, type AiToolInfo } from '@devias/core';
import { toolLabel } from '../../agent-chat/chat/tool-call-card';

export interface ToolGroup {
  key: AiToolArea;
  label: string;
  tools: AiToolInfo[];
}

/** The tools by area, areas in their order and tools by title; areas with no tool are left out. */
export const groupTools = (tools: AiToolInfo[]): ToolGroup[] =>
  AI_TOOL_AREAS.map((area) => ({
    key: area.key,
    label: area.label,
    tools: tools
      .filter((tool) => tool.area === area.key)
      .sort((a, b) => toolLabel(a.name).title.localeCompare(toolLabel(b.name).title)),
  })).filter((group) => group.tools.length > 0);
