import type { AuthUser, Member, Organization } from '@devias/core';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useMemo } from 'react';
import { CommandMenu } from '../commands/command-menu';
import { keys } from '../query/keys';
import { useAuth } from './auth';
import { BreadcrumbsProvider } from './breadcrumbs';
import { ClientProvider } from './client';
import { CommandsProvider } from './commands';
import { CreateRecordProvider } from './create-record';
import { LabelsProvider } from './labels';
import { LiveUpdatesProvider } from './live-updates';
import { SchemaProvider } from './schema';
import { type WorkspaceContextValue, WorkspaceProvider } from './workspace';

const NO_MEMBERS: Member[] = [];

/** Everything a workspace route needs: client, schema, labels, live updates, commands and dialogs. */
export function WorkspaceProviders({
  organization,
  user,
  children,
}: {
  organization: Organization;
  user: AuthUser;
  children: ReactNode;
}) {
  const auth = useAuth();
  const members = useQuery({
    queryKey: keys.members(organization.id),
    queryFn: () => auth.organizations.members.list(organization.id),
    staleTime: 60_000,
    retry: false,
  });
  const role = members.data?.find((m) => m.userId === user.id)?.role ?? 'member';
  const value = useMemo<WorkspaceContextValue>(
    () => ({
      workspaceId: organization.id,
      slug: organization.slug,
      organization,
      user,
      role,
      isAdmin: role === 'owner' || role === 'admin',
      roleStatus: members.isPending ? 'loading' : 'ready',
      members: members.data ?? NO_MEMBERS,
    }),
    [organization, user, role, members.isPending, members.data],
  );

  return (
    <WorkspaceProvider value={value}>
      <ClientProvider workspaceId={organization.id}>
        <SchemaProvider>
          <LabelsProvider>
            <LiveUpdatesProvider>
              <BreadcrumbsProvider>
                <CreateRecordProvider>
                  <CommandsProvider>
                    {children}
                    <CommandMenu />
                  </CommandsProvider>
                </CreateRecordProvider>
              </BreadcrumbsProvider>
            </LiveUpdatesProvider>
          </LabelsProvider>
        </SchemaProvider>
      </ClientProvider>
    </WorkspaceProvider>
  );
}
