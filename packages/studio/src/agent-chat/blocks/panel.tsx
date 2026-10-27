import { coreIds, defineBlockComponent } from '@devias/core';
import { AgentChatPanel } from '../chat/agent-chat-panel';

/** The docked chat panel, toggled with ⌘J. */
export const agentPanelBlock = defineBlockComponent({
  id: coreIds.blocks.agent_chat,
  label: 'Agent chat',
  icon: 'agent',
  surfaces: { panel: { shortcut: 'mod+j', defaultSize: 24, minSize: 18 } },
  component: AgentChatPanel,
});
