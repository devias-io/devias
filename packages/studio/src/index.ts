// Entry points

// Auth
export {
  type BetterAuthAdapterOptions,
  type BetterAuthClientLike,
  type BetterAuthResult,
  betterAuthAdapter,
} from './auth/better-auth-adapter';
export { AuthLayout, InvitePage, SignInPage, SignUpPage, slugify, WorkspacesPage } from './auth/pages';
export { builtinCommands, createRecordProvider, navigationProvider } from './commands/builtin';
export { CommandMenu } from './commands/command-menu';
export {
  chordFromEvent,
  createSequenceMatcher,
  formatShortcut,
  isTypingTarget,
  type KeyBinding,
  type KeyEventLike,
  parseShortcut,
  type SequenceMatcher,
} from './commands/keybindings';
export { RichMarkdown } from './components/markdown';
// Fields, views, records, commands, pages
export * from './editor';
export * from './fields';
export { useActivity } from './hooks/use-activity';
export { useAgentNames, useAgents } from './hooks/use-agents';
export { useDebouncedValue } from './hooks/use-debounced-value';
export {
  connectionName,
  type RuntimeModule,
  useAuthorizeConnection,
  useConnections,
  useCreateConnection,
  useDisconnect,
  useJobs,
  useModuleCatalog,
  useModuleEvents,
  useModuleVariables,
  useRetryJob,
  useRunModuleAction,
  useRuntimeModules,
  useTestConnection,
  useUpdateConnection,
  useUpdateModuleVariables,
} from './hooks/use-module-connections';
export {
  errorMessage,
  patchRecordInData,
  removeRecordsFromData,
  useCreateRecord,
  useDeleteRecords,
  useUpdateRecord,
} from './hooks/use-mutations';
export { useNavigateTo } from './hooks/use-navigate-to';
export {
  useDeleteNotification,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useMarkNotificationUnread,
  useNotifications,
  useUnreadNotificationCount,
} from './hooks/use-notifications';
export { type SaveStatus, useRecordAutosave } from './hooks/use-record-autosave';
export { useAggregate, useInfiniteRecords, useRecord, useRecordCount, useRecords } from './hooks/use-records';
export { type RelatedLabels, useRelatedLabels } from './hooks/use-related-labels';
export { useFields, useObject, useViews } from './hooks/use-schema-lookups';
export {
  useDeleteWorkflow,
  useRunWorkflow,
  useSaveWorkflow,
  useWorkflowRuns,
  useWorkflows,
} from './hooks/use-workflows';
export { manifest as studioManifest } from './manifest';
export { studio } from './module';
export * from './pages';
export { ModulePolicies } from './pages/settings/sections/module-consent';
// Providers and hooks
export { useAuth } from './providers/auth';
export { type Crumb, useBreadcrumbs, useSetBreadcrumbs } from './providers/breadcrumbs';
export { ClientProvider, ClientValueProvider, useClient } from './providers/client';
export { type CommandsContextValue, useCommands } from './providers/commands';
export { type CreateRecordRequest, useOpenCreateRecord } from './providers/create-record';
export { LabelResolver, recordLabel, useLabels } from './providers/labels';
export { useLiveStatus } from './providers/live-updates';
export { type SchemaContextValue, SchemaValueProvider, schemaContextValue, useSchema } from './providers/schema';
export { useStudioConfig } from './providers/studio-config';
export { roleSatisfies, useWorkspace, type WorkspaceContextValue, WorkspaceProvider } from './providers/workspace';
export { WorkspaceProviders } from './providers/workspace-providers';
export { keys } from './query/keys';
export * from './record';
// Registries
export {
  getFieldType,
  useAvailablePages,
  useBlock,
  useBlocks,
  useCoreModules,
  useFieldType,
  useFieldTypes,
  usePage,
  useViewType,
} from './registries';
export { unknownFieldType } from './registries/unknown-field-type';
export { renderStudio } from './render';
// Router
export { createStudioRouter, type RouterContext, type StudioRouter } from './router/create-router';
export { isActiveHref, links, splitHref } from './router/links';
export {
  createStaticNavigation,
  type Navigation,
  NavigationProvider,
  type StudioLinkProps,
  useNavigation,
} from './router/navigation';
export { clearAuthCache } from './router/session-cache';
// Shell
export { BlockDialog } from './shell/block-dialog';
export { readPanelSize, useDock, writePanelSize } from './shell/dock';
export { DriftBanner, type ManifestDrift, useManifestDrift } from './shell/drift-banner';
export { ErrorBoundary } from './shell/error-boundary';
export { navTargetHref, resolveViewParam } from './shell/nav-targets';
export { useNotificationInbox } from './shell/notifications/inbox-store';
export { NotificationToasts, showNotificationToast } from './shell/notifications/notification-toasts';
export { notificationsBlock, useNotificationBadge } from './shell/notifications/notifications-block';
export { NotificationsPanel } from './shell/notifications/notifications-panel';
export { senderOf } from './shell/notifications/sender';
export { firstLine, notificationTargetHref, useOpenNotification } from './shell/notifications/target';
export { PageSkeleton, TableSkeleton } from './shell/skeletons';
export { nodeToItems, resolveStructure, type StructureResolveContext } from './shell/structure';
export { StudioShell } from './shell/studio-shell';
export { createStudioQueryClient, Studio, type StudioProps } from './studio';
export * from './views';
