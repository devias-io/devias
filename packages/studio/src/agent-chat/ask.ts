import { coreIds } from '@devias/core';
import { useDock } from '../shell/dock';
import { useAgentChatStore } from './chat/store';

/** The agent's docked panel block. */
export const AGENT_PANEL_ID = coreIds.blocks.agent_chat;
/** The "I want to …" composer block under the Home grid. */
export const ASK_AGENT_BLOCK_ID = coreIds.blocks.ask_agent;

/**
 * Opens the panel and sends `text` in a new conversation with an agent (the workspace's default when none is named).
 * The prompt is queued for the panel, the one place that talks to agents, so it works from anywhere (e.g. Home)
 * whether or not the panel is already open.
 */
export const askAgent = (workspaceId: string, text: string, agentId?: string): void => {
  useAgentChatStore.getState().queuePrompt(workspaceId, { text, agentId });
  useDock.getState().open(AGENT_PANEL_ID);
};
