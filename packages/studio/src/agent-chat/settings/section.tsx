import { defineSettingsSection } from '@devias/core';
import { Section, Skeleton } from '@devias/ui';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../../hooks/use-mutations';
import { useClient } from '../../providers/client';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { formatTokens } from '../format';

/**
 * What AI is in this workspace: whether it is configured, the model, and how much the person has used. What an agent
 * may do is the agent's own (its tools and how each asks), on its page under Agents.
 */
function AiSettings() {
  const client = useClient();
  const { workspaceId } = useWorkspace();
  const status = useQuery({ queryKey: keys.aiStatus(workspaceId), queryFn: () => client.ai.status() });
  const conversations = useQuery({
    queryKey: keys.aiConversations(workspaceId),
    queryFn: () => client.ai.conversations.list({ limit: 200 }),
  });

  const usage = (conversations.data ?? []).reduce(
    (acc, c) => ({ input: acc.input + c.usage.inputTokens, output: acc.output + c.usage.outputTokens }),
    { input: 0, output: 0 },
  );

  if (status.isPending) {
    return <Skeleton className="h-24 w-full" />;
  }

  if (status.isError) {
    return <div className="text-xs text-destructive">{errorMessage(status.error)}</div>;
  }

  const data = status.data;

  if (!data) {
    return null;
  }

  return (
    <Section title="Configuration" description="Model and status of AI in this workspace.">
      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-3 text-xs">
        <dt className="text-muted-foreground">Status</dt>
        <dd>
          {data.configured ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-success" /> Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-muted-foreground" /> Not configured (set the AI provider's API key
              on the server)
            </span>
          )}
        </dd>
        <dt className="text-muted-foreground">Model</dt>
        <dd className="font-mono text-xs">{data.model || '-'}</dd>
        <dt className="text-muted-foreground">Effort</dt>
        <dd>{data.effort || '-'}</dd>
        <dt className="text-muted-foreground">Your usage</dt>
        <dd className="tabular-nums">
          {formatTokens(usage.input)} input · {formatTokens(usage.output)} output tokens across{' '}
          {conversations.data?.length ?? 0} conversation{conversations.data?.length === 1 ? '' : 's'}
        </dd>
      </dl>
    </Section>
  );
}

export const aiSettingsSection = defineSettingsSection({
  name: 'ai',
  label: 'AI',
  icon: 'agent',
  group: 'workspace',
  component: AiSettings,
});
