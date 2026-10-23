import {
  DOCUMENT_MENTION,
  type EventStreamStatus,
  isDocumentEvent,
  isModuleRuntimeEvent,
  isNotificationEvent,
  isRecordCommentEvent,
  isRecordEvent,
  isTaskEvent,
  isWorkflowEvent,
  TASK_MENTION,
  type WorkspaceEvent,
} from '@devias/core';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react';
import { keys } from '../query/keys';
import { useNotificationInbox } from '../shell/notifications/inbox-store';
import { useClient } from './client';
import { useLabels } from './labels';
import { useWorkspace } from './workspace';

const BATCH_MS = 150;
const POLL_MS = 30_000;

const LiveStatusContext = createContext<EventStreamStatus>('closed');

/**
 * Subscribes once per workspace to the change feed, batches events for 150 ms and invalidates the affected
 * queries; notifications that arrive for the person are queued for the toasts. Falls back to polling every 30 s
 * while the stream is not open.
 */
export function LiveUpdatesProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const queryClient = useQueryClient();
  const labels = useLabels();
  const { user } = useWorkspace();
  const userId = user.id;
  const [status, setStatus] = useState<EventStreamStatus>('connecting');
  const ws = client.workspaceId;

  useEffect(() => {
    let pending: WorkspaceEvent[] = [];
    let timer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      timer = undefined;
      const batch = pending;
      pending = [];
      const objects = new Set<string>();
      const changedIds = new Map<string, string[]>();
      const commented = new Map<string, { object: string; recordId: string }>();
      let schemaChanged = false;
      let workflowsChanged = false;
      const documentIds: string[] = [];
      const taskIds: string[] = [];
      let connectionsChanged = false;
      let jobsChanged = false;
      let notificationsChanged = false;
      const arrived: string[] = [];

      for (const event of batch) {
        if (isWorkflowEvent(event)) {
          workflowsChanged = true;
        } else if (isDocumentEvent(event)) {
          documentIds.push(event.documentId);
        } else if (isTaskEvent(event)) {
          taskIds.push(event.taskId);
        } else if (event.type === 'job.failed') {
          jobsChanged = true;
        } else if (isModuleRuntimeEvent(event)) {
          connectionsChanged = true;
        } else if (isNotificationEvent(event)) {
          notificationsChanged = true;

          if (event.action === 'created' && event.recipientId === userId && event.notificationId) {
            arrived.push(event.notificationId);
          }
        } else if (isRecordCommentEvent(event)) {
          commented.set(`${event.object}/${event.recordId}`, event);
        } else if (isRecordEvent(event)) {
          objects.add(event.object);
          const list = changedIds.get(event.object) ?? [];
          list.push(event.recordId);
          changedIds.set(event.object, list);
        } else {
          schemaChanged = true;
        }
      }

      // Record changes refresh activity through the records key.
      for (const { object, recordId } of commented.values()) {
        void queryClient.invalidateQueries({ queryKey: keys.comments(ws, object, recordId) });
      }

      for (const object of objects) {
        labels.invalidate(object, changedIds.get(object));
        void queryClient.invalidateQueries({ queryKey: keys.records(ws, object) });
        void queryClient.invalidateQueries({ queryKey: keys.labels(ws, object) });
      }

      // A document that changed refreshes the lists, the open page's copy and the titles mentions show.
      if (documentIds.length > 0) {
        labels.invalidate(DOCUMENT_MENTION, documentIds);
        void queryClient.invalidateQueries({ queryKey: keys.documents(ws) });
        void queryClient.invalidateQueries({ queryKey: keys.labels(ws, DOCUMENT_MENTION) });
      }

      // A task that changed refreshes the lists, the open page, its timeline, the counts and the titles mentions show.
      if (taskIds.length > 0) {
        labels.invalidate(TASK_MENTION, taskIds);
        void queryClient.invalidateQueries({ queryKey: keys.tasks(ws) });
        void queryClient.invalidateQueries({ queryKey: keys.labels(ws, TASK_MENTION) });
      }

      if (schemaChanged) {
        void queryClient.invalidateQueries({ queryKey: keys.schema(ws) });
        void queryClient.invalidateQueries({ queryKey: keys.modules(ws) });
      }

      // Workflow changes and finished runs refresh the workflow list and every runs list under it.
      if (workflowsChanged) {
        void queryClient.invalidateQueries({ queryKey: keys.workflows(ws) });
      }

      // Connection changes and delivered events refresh the connections and every events list under them.
      if (connectionsChanged) {
        void queryClient.invalidateQueries({ queryKey: keys.connections(ws) });
      }

      // A job that failed for good refreshes the job lists.
      if (jobsChanged) {
        void queryClient.invalidateQueries({ queryKey: keys.jobs(ws) });
      }

      // Notification changes refresh the lists and the unread count; new ones for this person also toast.
      if (notificationsChanged) {
        void queryClient.invalidateQueries({ queryKey: keys.notifications(ws) });
      }

      if (arrived.length > 0) {
        useNotificationInbox.getState().arrive(arrived);
      }
    };
    const unsubscribe = client.events.subscribe(
      (event) => {
        pending.push(event);

        if (!timer) {
          timer = setTimeout(flush, BATCH_MS);
        }
      },
      { onStatus: setStatus },
    );

    return () => {
      unsubscribe();

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [client, queryClient, labels, ws, userId]);

  useEffect(() => {
    if (status === 'open') {
      return;
    }

    const id = setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: keys.workspace(ws) });
    }, POLL_MS);

    return () => clearInterval(id);
  }, [status, queryClient, ws]);

  return <LiveStatusContext.Provider value={status}>{children}</LiveStatusContext.Provider>;
}

export const useLiveStatus = (): EventStreamStatus => useContext(LiveStatusContext);
