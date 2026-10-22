import {
  type Connection,
  type ConnectionAuthorize,
  type ConnectionCreate,
  type ConnectionPatch,
  type ConnectionProviderStatus,
  declaresRuntime,
  type InstalledModule,
  MODULE_EVENT_DEFAULT_LIMIT,
} from '@devias/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { useSchema } from '../providers/schema';
import { keys } from '../query/keys';
import { errorMessage } from './use-mutations';

/** Every module the server can install, by manifest; it only changes with a deploy. */
export const useModuleCatalog = () => {
  const client = useClient();

  return useQuery({
    queryKey: keys.moduleCatalog(client.workspaceId),
    queryFn: () => client.modules.catalog(),
    staleTime: 5 * 60_000,
  });
};

/** The workspace's connections and the caller's own, with the providers installed modules offer; kept fresh by live updates. */
export const useConnections = () => {
  const client = useClient();

  return useQuery({
    queryKey: keys.connections(client.workspaceId),
    queryFn: () => client.modules.connections.list(),
    staleTime: 30_000,
  });
};

/** A module's events, newest first, a page at a time. */
export const useModuleEvents = (moduleId: string | null) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: keys.moduleEvents(client.workspaceId, moduleId ?? ''),
    queryFn: ({ pageParam }) =>
      client.modules.events(moduleId ?? '', {
        limit: MODULE_EVENT_DEFAULT_LIMIT,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: moduleId !== null,
  });
};

/** An installed module with connections, variables, actions or events, with its providers and the connections the caller may see. */
export type RuntimeModule = {
  module: InstalledModule;
  providers: ConnectionProviderStatus[];
  connections: Connection[];
};

/** Installed modules with connections, variables, actions or events, for pickers and summaries. */
export const useRuntimeModules = () => {
  const { schema } = useSchema();
  const list = useConnections();
  const items: RuntimeModule[] = schema.modules.filter(declaresRuntime).map((module) => ({
    module,
    providers: (list.data?.providers ?? []).filter((provider) => provider.moduleId === module.moduleId),
    connections: (list.data?.connections ?? []).filter((connection) => connection.moduleId === module.moduleId),
  }));

  return { items, isPending: list.isPending };
};

/** How a connection reads in lists: its label, else who it is for, else whose it is. */
export const connectionName = (connection: Connection): string =>
  connection.label ?? connection.account ?? (connection.visibility === 'workspace' ? 'Workspace' : 'Yours');

const useRefresh = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return () => queryClient.invalidateQueries({ queryKey: keys.connections(client.workspaceId) });
};

/** Says how a saved or tested connection fared: tested fine, or what the service answered. */
const reportOutcome = (connection: Connection, name: string) => {
  if (connection.status === 'auth_failed') {
    toast.error(connection.lastError ?? `${name} could not be verified`);
  } else {
    toast.success(`${name} connected`);
  }
};

export const useCreateConnection = () => {
  const client = useClient();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: ({ input }: { input: ConnectionCreate; name: string }) => client.modules.connections.create(input),
    onSuccess: (connection, { name }) => {
      reportOutcome(connection, name);
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useUpdateConnection = () => {
  const client = useClient();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: ConnectionPatch; name: string }) =>
      client.modules.connections.update(id, patch),
    onSuccess: (connection, { name }) => {
      reportOutcome(connection, name);
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useTestConnection = () => {
  const client = useClient();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => client.modules.connections.test(id),
    onSuccess: (result, { name }) => {
      if (result.ok) {
        toast.success(result.message ?? `${name} works`);
      } else {
        toast.error(result.message ?? `${name} could not be verified`);
      }

      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useDisconnect = () => {
  const client = useClient();
  const refresh = useRefresh();

  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => client.modules.connections.disconnect(id),
    onSuccess: (_, { name }) => {
      toast.success(`${name} disconnected`);
      void refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Start connecting an account: the browser goes to the provider's consent page and comes back to this page. */
export const useAuthorizeConnection = () => {
  const client = useClient();

  return useMutation({
    mutationFn: (input: ConnectionAuthorize) => client.modules.connections.authorize(input),
    onSuccess: ({ url }) => window.location.assign(url),
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useModuleVariables = (moduleId: string) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.moduleVariables(client.workspaceId, moduleId),
    queryFn: () => client.modules.variables.list(moduleId),
  });
};

export const useUpdateModuleVariables = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ moduleId, values }: { moduleId: string; name: string; values: Record<string, string> }) =>
      client.modules.variables.update(moduleId, values),
    onSuccess: (variables, { moduleId, name }) => {
      toast.success(`${name} saved`);
      queryClient.setQueryData(keys.moduleVariables(client.workspaceId, moduleId), variables);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/**
 * Back from a provider's consent page: the server sends people to the page they started from with `?oauth=connected`
 * (and the module) or `?oauth=failed` (and why). Say how it went once, then drop the parameters.
 */
export const useOAuthReturn = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  useEffect(() => {
    const url = new URL(window.location.href);
    const outcome = url.searchParams.get('oauth');

    if (!outcome) {
      return;
    }

    if (outcome === 'connected') {
      toast.success(`${url.searchParams.get('module') ?? 'The account'} is connected`);
    } else {
      toast.error(url.searchParams.get('message') ?? 'The account was not connected');
    }

    for (const key of ['oauth', 'module', 'message']) {
      url.searchParams.delete(key);
    }

    window.history.replaceState(window.history.state, '', url.toString());
    void queryClient.invalidateQueries({ queryKey: keys.connections(client.workspaceId) });
  }, [client.workspaceId, queryClient]);
};

/** A module's background jobs, newest first: what ran, what failed and why. */
export const useJobs = (moduleId: string) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.jobs(client.workspaceId, moduleId),
    queryFn: () => client.modules.jobs.list({ module: moduleId, limit: 50 }),
    staleTime: 15_000,
  });
};

export const useRetryJob = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; name: string }) => client.modules.jobs.retry(id),
    onSuccess: (_job, { name }) => {
      toast.success(`${name} will run again shortly`);
      void queryClient.invalidateQueries({ queryKey: keys.jobs(client.workspaceId) });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Run an installed module's action now, as the person; the records it may have changed refresh. */
export const useRunModuleAction = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ module, action, input }: { module: string; action: string; input?: Record<string, unknown> }) =>
      client.modules.runAction(module, action, input),
    onError: (error) => toast.error(errorMessage(error)),
    // Which records an action touched is not known here.
    onSettled: () => queryClient.invalidateQueries({ queryKey: [...keys.workspace(client.workspaceId), 'records'] }),
  });
};
