import { useQuery } from '@tanstack/react-query';
import { useClient } from '../providers/client';
import { useWorkspace } from '../providers/workspace';
import { keys } from '../query/keys';

/** The workspace's skills, archived ones too and without their text, for people who manage agents. */
export const useAllSkills = (enabled = true) => {
  const client = useClient();
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: keys.aiSkills(workspaceId),
    queryFn: () => client.ai.skills.list({ includeArchived: true }),
    enabled,
    staleTime: 60_000,
  });
};

/** One skill in full, for its page. */
export const useSkill = (id: string | undefined) => {
  const client = useClient();
  const { workspaceId } = useWorkspace();

  return useQuery({
    queryKey: keys.aiSkill(workspaceId, id ?? ''),
    queryFn: () => client.ai.skills.get(id ?? ''),
    enabled: id !== undefined,
  });
};
