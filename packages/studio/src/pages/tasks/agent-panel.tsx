import { coreIds, type Task } from '@devias/core';
import { Button, Icon } from '@devias/ui';
import { AgentMark } from '../../agent-chat/agent-mark';
import { useAgentChatStore } from '../../agent-chat/chat/store';
import { useAssignees } from '../../components/assignee';
import { useRunControl, useTaskRuns } from '../../hooks/use-tasks';
import { ago } from '../../lib/time';
import { useWorkspace } from '../../providers/workspace';
import { useDock } from '../../shell/dock';

/** What the agent is doing about the task, in a sentence. */
const stateOf = (task: Task): { text: string; tone: 'quiet' | 'busy' | 'ask' | 'bad' } => {
  switch (task.work) {
    case 'working':
      return { text: 'Working on it', tone: 'busy' };
    case 'waiting_on_you':
      return { text: 'Waiting for your review', tone: 'ask' };
    case 'waiting_on_subtasks':
      return { text: 'Waiting for its subtasks', tone: 'quiet' };
    case 'failed':
      return { text: 'Stopped, or it failed', tone: 'bad' };
    default:
      return task.status === 'in_review'
        ? { text: 'Handed in for your review', tone: 'ask' }
        : task.status === 'todo'
          ? { text: 'In the agent’s queue', tone: 'quiet' }
          : { text: 'Not started', tone: 'quiet' };
  }
};

/**
 * The agent a task is given to: where it is with it, what it said it did, and what a person can do: look at what it
 * proposes and approve it in the chat, stop it, or send a failed task back to its queue.
 */
export function AgentPanel({ task }: { task: Task }) {
  const { workspaceId } = useWorkspace();
  const { card } = useAssignees();
  const agent = task.assignee?.startsWith('agent:') ? card(task.assignee) : null;
  const runs = useTaskRuns(task.id, agent !== null);
  const { stop, retry } = useRunControl(task.id);

  if (!agent) {
    return null;
  }

  const latest = runs.data?.items[0];
  const state = stateOf(task);
  const working = task.work === 'working' || task.work === 'waiting_on_you';
  const review = () => {
    if (latest) {
      useAgentChatStore.getState().setActive(workspaceId, latest.conversationId);
      useDock.getState().open(coreIds.blocks.agent_chat);
    }
  };

  return (
    <section data-slot="agent-panel" data-work={task.work ?? undefined} className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-muted-foreground">Agent</h3>
      <div className="flex items-center gap-2 text-xs">
        <AgentMark icon={agent.icon} tile className="size-6" />
        <span className="min-w-0 flex-1 truncate font-medium">{agent.name}</span>
      </div>
      <p
        className={
          state.tone === 'bad'
            ? 'flex items-center gap-1.5 text-xs text-destructive'
            : 'flex items-center gap-1.5 text-xs text-muted-foreground'
        }
      >
        {state.tone === 'busy' ? <Icon name="loader-circle" className="size-3.5 animate-spin" /> : null}
        {state.text}
        {latest && working ? <span>· {ago(latest.startedAt)}</span> : null}
      </p>
      {latest?.summary && task.work !== 'working' ? (
        <p className="rounded-md bg-muted/50 px-2.5 py-2 text-xs whitespace-pre-line">{latest.summary}</p>
      ) : null}
      {latest?.error && task.work === 'failed' ? <p className="text-xs text-muted-foreground">{latest.error}</p> : null}
      <div className="flex flex-wrap gap-2">
        {latest && (task.work === 'waiting_on_you' || working) ? (
          <Button size="sm" variant={task.work === 'waiting_on_you' ? 'default' : 'outline'} onClick={review}>
            {task.work === 'waiting_on_you' ? 'Review what it proposes' : 'Watch it work'}
          </Button>
        ) : null}
        {working ? (
          <Button size="sm" variant="outline" disabled={stop.isPending} onClick={() => stop.mutate()}>
            Stop
          </Button>
        ) : null}
        {task.work === 'failed' ? (
          <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
            Try again
          </Button>
        ) : null}
        {latest && !working ? (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={review}>
            See its work
          </Button>
        ) : null}
      </div>
    </section>
  );
}
