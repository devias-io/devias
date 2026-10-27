import type { AiAgent, AiAgentUsage, AiSettings } from '@devias/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useClient } from '../providers/client';
import { useWorkspace } from '../providers/workspace';
import { keys } from '../query/keys';

/** The workspace's active agents, cached for a minute. */
export const useAgents = () => {
  const client = useClient();
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: keys.aiAgents(workspaceId),
    queryFn: () => client.ai.agents.list(),
    staleTime: 60_000,
  });
};

/** Active and archived agents: to manage them, and to name an archived agent in a thread or in history. */
export const useAllAgents = () => {
  const client = useClient();
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: keys.aiAgentsAll(workspaceId),
    queryFn: () => client.ai.agents.list({ includeArchived: true }),
    staleTime: 60_000,
  });
};

/** Conversations and tokens per agent, by agent id; only for people who manage agents (others get nothing). */
export const useAgentUsage = (enabled: boolean): Map<string, AiAgentUsage> => {
  const client = useClient();
  const { workspaceId } = useWorkspace();
  const usage = useQuery({
    queryKey: keys.aiAgentUsage(workspaceId),
    queryFn: () => client.ai.agents.usage(),
    enabled,
    staleTime: 30_000,
  });

  return useMemo(() => new Map((usage.data ?? []).map((row) => [row.agentId, row])), [usage.data]);
};

/** The time zone of this browser, so days start at the person's midnight. */
const timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** One agent's conversations, replies and tokens per day over the last `days` days (for people who manage agents). */
export const useAgentActivity = (agentId: string, days: number) => {
  const client = useClient();
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: keys.aiAgentActivity(workspaceId, agentId, days),
    queryFn: () => client.ai.agents.activity(agentId, { days, tz: timeZone() }),
    // Switching the period keeps the last figures on screen until the new ones land.
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
};

/** The workspace's AI settings (its default agent, its approval overrides). */
export const useAiSettings = () => {
  const client = useClient();
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: keys.aiSettings(workspaceId),
    queryFn: () => client.ai.settings.get(),
    staleTime: 60_000,
  });
};

/** The agent Home and a new conversation use: the workspace's choice while it is active, else the first by name. */
export const defaultAgentOf = (
  agents: readonly AiAgent[],
  settings: Pick<AiSettings, 'defaultAgentId'> | undefined,
): AiAgent | null => {
  const active = agents.filter((agent) => !agent.archivedAt);

  return active.find((agent) => agent.id === settings?.defaultAgentId) ?? active[0] ?? null;
};

export const useDefaultAgent = (): AiAgent | null => {
  const agents = useAgents();
  const settings = useAiSettings();

  return useMemo(() => defaultAgentOf(agents.data ?? [], settings.data), [agents.data, settings.data]);
};

/** Agents by id with what says who they are (name, icon, what they are for), archived ones included, to show who acted in a record's history. */
export const useAgentCards = (): Map<string, { name: string; icon: string | null; description: string | null }> => {
  const agents = useAllAgents();

  return useMemo(
    () =>
      new Map(
        (agents.data ?? []).map((agent: AiAgent) => [
          agent.id,
          { name: agent.label, icon: agent.icon, description: agent.description },
        ]),
      ),
    [agents.data],
  );
};

/** Agent names by id, archived ones included, to say who acted in a record's history. */
export const useAgentNames = (): Map<string, string> => {
  const agents = useAllAgents();

  return useMemo(() => new Map((agents.data ?? []).map((agent: AiAgent) => [agent.id, agent.label])), [agents.data]);
};
