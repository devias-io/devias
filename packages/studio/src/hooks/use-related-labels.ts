import { useQuery } from '@tanstack/react-query';
import { useClient } from '../providers/client';
import { useLabels } from '../providers/labels';
import { keys } from '../query/keys';

export interface RelatedLabels {
  labels: Record<string, string>;
  isLoading: boolean;
  /** Label for an id, falling back to the id while loading. */
  get: (id: string | null | undefined) => string;
}

/**
 * Resolve display labels for related record ids of one object. Requests from all cells in the same tick are
 * batched into a single `in` query and cached; live updates invalidate changed records.
 */
export const useRelatedLabels = (
  object: string | undefined,
  ids: readonly (string | null | undefined)[],
): RelatedLabels => {
  const client = useClient();
  const labels = useLabels();
  const resolver = object ? labels.get(object) : undefined;
  const clean = [...new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0))].sort();
  const query = useQuery({
    queryKey: keys.labels(client.workspaceId, object ?? '__none__', clean),
    queryFn: () => (resolver as NonNullable<typeof resolver>).load(clean),
    enabled: Boolean(resolver) && clean.length > 0,
    staleTime: 5 * 60_000,
  });
  const data = query.data ?? {};

  return {
    labels: data,
    isLoading: Boolean(resolver) && clean.length > 0 && query.isPending,
    get: (id) => (id ? (data[id] ?? resolver?.peek(id) ?? id) : ''),
  };
};
