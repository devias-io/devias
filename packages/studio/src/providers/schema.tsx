import { indexSchema, type SchemaIndex, type WorkspaceSchema } from '@devias/core';
import { Button, EmptyState, Skeleton } from '@devias/ui';
import { useQuery } from '@tanstack/react-query';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { keys } from '../query/keys';
import { useClient } from './client';

export interface SchemaContextValue {
  schema: WorkspaceSchema;
  index: SchemaIndex;
  refetch: () => void;
}

const SchemaContext = createContext<SchemaContextValue | null>(null);

export const SchemaValueProvider = SchemaContext.Provider;

/** Loads the workspace schema once (kept fresh by live updates) and blocks children until it is available. */
export function SchemaProvider({ children }: { children: ReactNode }) {
  const client = useClient();
  const query = useQuery({
    queryKey: keys.schema(client.workspaceId),
    queryFn: () => client.metadata.getSchema(),
    staleTime: Number.POSITIVE_INFINITY,
  });
  const value = useMemo<SchemaContextValue | null>(
    () =>
      query.data
        ? {
            schema: query.data,
            index: indexSchema(query.data),
            refetch: () => {
              void query.refetch();
            },
          }
        : null,
    [query.data, query.refetch],
  );

  if (!value) {
    if (query.isError) {
      return (
        <EmptyState
          icon="circle-alert"
          title="Could not load the workspace"
          description={query.error instanceof Error ? query.error.message : 'Unknown error'}
          action={
            <Button size="lg" variant="outline" onClick={() => void query.refetch()}>
              Retry
            </Button>
          }
        />
      );
    }

    return (
      <div className="flex flex-col gap-3 p-6">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return <SchemaContext.Provider value={value}>{children}</SchemaContext.Provider>;
}

export const useSchema = (): SchemaContextValue => {
  const value = useContext(SchemaContext);

  if (!value) {
    throw new Error('useSchema must be used inside a workspace route');
  }

  return value;
};

/** Builds a schema context value from a schema (tests and embedding). */
export const schemaContextValue = (schema: WorkspaceSchema): SchemaContextValue => ({
  schema,
  index: indexSchema(schema),
  refetch: () => {},
});
