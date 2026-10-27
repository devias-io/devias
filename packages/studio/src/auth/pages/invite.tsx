import { Badge, Button, Skeleton } from '@devias/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../providers/auth';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { clearAuthCache } from '../../router/session-cache';
import { AuthLayout } from './auth-layout';

export function InvitePage() {
  const auth = useAuth();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const invitationId = navigation.params.invitationId ?? '';
  const invitation = useQuery({
    queryKey: keys.invitation(invitationId),
    queryFn: () => auth.organizations.invitations.get(invitationId),
    enabled: Boolean(invitationId),
    retry: false,
  });
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);

    try {
      const { organizationId } = await auth.organizations.invitations.accept(invitationId);
      clearAuthCache();
      await queryClient.invalidateQueries({ queryKey: keys.organizations() });
      const organization = (await auth.organizations.list()).find((o) => o.id === organizationId);

      if (organization) {
        await auth.organizations.setActive({ organizationId });
        navigation.navigate(links.workspace(organization.slug), { replace: true });
      } else {
        navigation.navigate(links.workspaces(), { replace: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not accept the invitation');
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    setBusy(true);

    try {
      await auth.organizations.invitations.reject(invitationId);
      navigation.navigate(links.workspaces(), { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not reject the invitation');
    } finally {
      setBusy(false);
    }
  };

  const data = invitation.data;

  return (
    <AuthLayout
      title="Workspace invitation"
      description={data ? `You were invited to join ${data.organizationName ?? 'a workspace'}.` : undefined}
      footer={
        <navigation.Link href={links.workspaces()} className="hover:text-foreground">
          Go to my workspaces
        </navigation.Link>
      }
    >
      {invitation.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : invitation.isError || !data ? (
        <p className="text-xs text-destructive">This invitation is invalid or has expired.</p>
      ) : data.status !== 'pending' ? (
        <p className="text-xs text-muted-foreground">This invitation was already {data.status}.</p>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-border bg-card p-4 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">{data.organizationName ?? data.organizationId}</span>
              <Badge variant="secondary">{data.role}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">Invitation for {data.email}</div>
          </div>
          <div className="flex gap-2">
            <Button className="h-10 flex-1" disabled={busy} onClick={() => void accept()}>
              Accept
            </Button>
            <Button variant="outline" className="h-10 flex-1" disabled={busy} onClick={() => void reject()}>
              Decline
            </Button>
          </div>
        </div>
      )}
    </AuthLayout>
  );
}
