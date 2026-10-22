import { definePageComponent } from '@devias/core';
import { Button, EmptyState } from '@devias/ui';
import { useQuery } from '@tanstack/react-query';
import { useAiSettings, useAllAgents } from '../../hooks/use-agents';
import { errorMessage } from '../../hooks/use-mutations';
import { ids } from '../../ids';
import { useClient } from '../../providers/client';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { PageSkeleton } from '../../shell/skeletons';
import { AgentEditorPage } from './agent-editor';
import { AgentsView } from './agents-view';

/** The tools agents can be given and whether the person may shape agents, loaded for the list and an agent's page. */
const useAgentsStatus = () => {
  const client = useClient();
  const { workspaceId } = useWorkspace();

  return useQuery({ queryKey: keys.aiStatus(workspaceId), queryFn: () => client.ai.status() });
};

/** Everyone sees the agents; owners and admins (`canManage`) shape them. */
export function AgentsPage() {
  const status = useAgentsStatus();

  if (status.isPending) {
    return <PageSkeleton />;
  }

  if (status.isError) {
    return <div className="p-4 text-xs text-destructive">{errorMessage(status.error)}</div>;
  }

  return <AgentsView tools={status.data.tools} canManage={status.data.canManage} />;
}

/** One agent's page (`/agents/:agentId`), or a new one (`/agents/new`). */
export function AgentPage() {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const status = useAgentsStatus();
  const agents = useAllAgents();
  const settings = useAiSettings();
  const agentId = navigation.params.agentId;
  const back = (
    <Button size="lg" variant="outline" onClick={() => navigation.navigate(links.agents(slug))}>
      Back to agents
    </Button>
  );

  if (status.isPending || agents.isPending || settings.isPending) {
    return <PageSkeleton />;
  }

  if (status.isError) {
    return <div className="p-4 text-xs text-destructive">{errorMessage(status.error)}</div>;
  }

  if (!status.data.canManage) {
    return (
      <EmptyState
        icon="lock"
        title="Agents are shaped by owners and admins"
        description="Ask a workspace admin to change this agent or to give you the admin role."
        action={back}
      />
    );
  }

  const agent = agentId ? (agents.data ?? []).find((item) => item.id === agentId) : undefined;

  if (agentId && !agent) {
    return (
      <EmptyState
        icon="circle-help"
        title="Agent not found"
        description="It may not exist in this workspace."
        action={back}
      />
    );
  }

  return <AgentEditorPage key={agent?.id ?? 'new'} agent={agent ?? null} tools={status.data.tools} />;
}

export const agentsPages = [
  definePageComponent({ id: ids.pages.agents, path: 'agents', component: AgentsPage }),
  definePageComponent({ path: 'agents/new', component: AgentPage }),
  definePageComponent({ path: 'agents/$agentId', component: AgentPage }),
];
