import { type ApprovalBlockProps, coreIds, defineBlockComponent } from '@devias/core';
import { Button, buttonVariants, cn, Icon } from '@devias/ui';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { AgentMark } from '../../agent-chat/agent-mark';
import { isPlain } from '../../agent-chat/chat/tool-call-summary';
import { useAllAgents } from '../../hooks/use-agents';
import { useClient } from '../../providers/client';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { AGENT_APPROVAL_TOOLS, summarizeAgentCall } from './approval-summary';

const SENTENCE = { create: 'Create', update: 'Change', archive: 'Archive' } as const;

/**
 * The card that asks the person to approve creating, changing or archiving an agent: what the agent will be, or what
 * changes against the agent as it is now, and a warning when the call hands it tools that reach beyond their name
 * (workflows, keys, members, modules, agents). Shaping agents always asks, so this is the one place that says what is
 * being granted.
 */
function ConfirmAgentChange({ call, busy, approve, reject }: ApprovalBlockProps) {
  const client = useClient();
  const { slug, workspaceId } = useWorkspace();
  const navigation = useNavigation();
  const agents = useAllAgents();
  const status = useQuery({ queryKey: keys.aiStatus(workspaceId), queryFn: () => client.ai.status() });
  const summary = useMemo(
    () => summarizeAgentCall(call, agents.data ?? [], status.data?.tools ?? []),
    [call, agents.data, status.data],
  );
  const input = isPlain(call.input) ? call.input : {};
  const current = agents.data?.find((agent) => agent.id === summary.agentId);
  const icon = typeof input.icon === 'string' ? input.icon : current?.icon;
  const pill = 'rounded-full px-3.5';

  return (
    <div data-slot="agent-approval" className="flex flex-col gap-3 rounded-lg bg-muted/60 px-4.5 py-4">
      <div className="flex items-start gap-3">
        <AgentMark tile icon={icon} className="size-9" />
        <div className="min-w-0">
          <p className="text-sm leading-snug">
            {SENTENCE[summary.verb]} the agent <span className="font-medium">{summary.name}</span>.
          </p>
          <ul className="mt-1 flex flex-col gap-0.5 text-muted-foreground">
            {summary.lines.map((line) => (
              <li key={line} className="break-words">
                {line}
              </li>
            ))}
          </ul>
        </div>
      </div>
      {summary.warning ? (
        <p className="flex items-start gap-1.5 text-warning" data-slot="agent-approval-warning">
          <Icon name="triangle-alert" className="mt-0.5 size-3.5 shrink-0" />
          {summary.warning}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className={pill} onClick={approve} disabled={busy} data-action="approve">
          Approve
        </Button>
        {summary.agentId ? (
          <navigation.Link
            href={links.agent(slug, summary.agentId)}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), pill)}
          >
            Review
          </navigation.Link>
        ) : null}
        <Button
          size="sm"
          variant="ghost"
          className={cn(pill, 'text-muted-foreground')}
          onClick={reject}
          disabled={busy}
          data-action="reject"
        >
          Reject
        </Button>
      </div>
    </div>
  );
}

/** Approval widget for the agent tools: create, change and archive. */
export const agentApprovalBlock = defineBlockComponent({
  id: coreIds.blocks.agent_approval,
  label: 'Confirm an agent change',
  icon: 'agent',
  surfaces: { approval: { tools: [...AGENT_APPROVAL_TOOLS] } },
  component: ConfirmAgentChange,
});
