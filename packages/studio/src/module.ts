import { defineCommand, defineModuleStudio } from '@devias/core';
import { AGENT_PANEL_ID } from './agent-chat/ask';
import { askAgentBlock } from './agent-chat/blocks/ask';
import { agentPanelBlock } from './agent-chat/blocks/panel';
import { aiSettingsSection } from './agent-chat/settings/section';
import { builtinCommands, createRecordProvider, navigationProvider } from './commands/builtin';
import { builtinFieldTypes } from './fields';
import { manifest } from './manifest';
import { agentsPages } from './pages/agents';
import { agentApprovalBlock } from './pages/agents/agent-approval';
import { documentsPages } from './pages/documents';
import { homePage } from './pages/home';
import { gettingStartedBlock } from './pages/home/blocks/getting-started';
import { openTasksBlock } from './pages/home/blocks/open-tasks';
import { recentDocumentsBlock } from './pages/home/blocks/recent-documents';
import { recentRecordsBlock } from './pages/home/blocks/recent-records';
import { recordCountsBlock } from './pages/home/blocks/record-counts';
import { recordsPages } from './pages/records';
import { settingsPages } from './pages/settings';
import { builtinSettingsSections } from './pages/settings/sections';
import { skillsPages } from './pages/skills';
import { tasksPages } from './pages/tasks';
import { workflowsPages } from './pages/workflows';
import { activityBlock } from './record/blocks/activity';
import { fieldsBlock } from './record/blocks/fields';
import { mentionedInBlock } from './record/blocks/mentioned-in';
import { noteApprovalBlock } from './record/blocks/note-approval';
import { notesBlock } from './record/blocks/notes';
import { relatedRecordsBlock } from './record/blocks/related-records';
import { richTextBlock } from './record/blocks/rich-text';
import { tasksBlock } from './record/blocks/tasks';
import { titleBlock } from './record/blocks/title';
import { useDock } from './shell/dock';
import { notificationsBlock } from './shell/notifications/notifications-block';
import { calendarViewType } from './views/calendar/calendar-view';
import { kanbanViewType } from './views/kanban/kanban-view';
import { tableViewType } from './views/table/table-view';

/**
 * Everything the studio ships with, as a module: field types, the table, kanban and calendar views, the record page
 * blocks, the default Home blocks (getting started, your data, recently updated), the notifications panel and the
 * agents (the docked chat, the Home composer, the command, the settings for approvals and the Agents pages), Home and the
 * other pages, commands, settings. List it first in `defineStudio({ modules: [studio(), …] })` so other modules
 * can override what it registers.
 */
export const studio = defineModuleStudio(manifest, {
  fieldTypes: builtinFieldTypes,
  viewTypes: [tableViewType, kanbanViewType, calendarViewType],
  blocks: [
    fieldsBlock,
    relatedRecordsBlock,
    activityBlock,
    notesBlock,
    tasksBlock,
    mentionedInBlock,
    titleBlock,
    richTextBlock,
    gettingStartedBlock,
    recordCountsBlock,
    recentRecordsBlock,
    openTasksBlock,
    recentDocumentsBlock,
    notificationsBlock,
    agentPanelBlock,
    askAgentBlock,
    agentApprovalBlock,
    noteApprovalBlock,
  ],
  pages: [
    homePage,
    ...recordsPages,
    ...tasksPages,
    ...documentsPages,
    ...workflowsPages,
    ...agentsPages,
    ...skillsPages,
    ...settingsPages,
  ],
  commands: [
    ...builtinCommands,
    defineCommand({
      id: 'agents.toggle',
      label: 'Toggle agent chat',
      icon: 'agent',
      group: 'Agents',
      keywords: ['ai', 'chat', 'help'],
      run: () => useDock.getState().toggle(AGENT_PANEL_ID),
    }),
  ],
  commandProviders: [navigationProvider, createRecordProvider],
  settingsSections: [...builtinSettingsSections, aiSettingsSection],
});

export { manifest as studioManifest };
