import { defineSettingsSection, type Member, type MemberRole } from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  cn,
  Icon,
  Input,
  OptionSelect,
  Section,
  Skeleton,
  TABLE_CELL,
  TABLE_ROW,
} from '@devias/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../../hooks/use-mutations';
import { useAuth } from '../../../providers/auth';
import { useWorkspace } from '../../../providers/workspace';
import { keys } from '../../../query/keys';
import { initials } from '../../../shell/user-menu';

const ROLES: MemberRole[] = ['member', 'admin', 'owner'];

function MembersSettings() {
  const auth = useAuth();
  const { organization, user, isAdmin, role: myRole } = useWorkspace();
  const queryClient = useQueryClient();
  const members = useQuery({
    queryKey: keys.members(organization.id),
    queryFn: () => auth.organizations.members.list(organization.id),
  });
  const invitations = useQuery({
    queryKey: keys.invitations(organization.id),
    queryFn: () => auth.organizations.members.listInvitations(organization.id),
    enabled: isAdmin,
  });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('member');
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<Member | null>(null);
  // Only owners can hand out ownership.
  const roleOptions = ROLES.filter((r) => r !== 'owner' || myRole === 'owner').map((r) => ({ value: r, label: r }));

  const invite = async () => {
    setInviting(true);

    try {
      await auth.organizations.members.invite(organization.id, { email: email.trim(), role });
      setEmail('');
      await queryClient.invalidateQueries({ queryKey: keys.invitations(organization.id) });
      toast.success(`Invitation sent to ${email.trim()}`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setInviting(false);
    }
  };
  const changeRole = async (member: Member, next: MemberRole) => {
    try {
      await auth.organizations.members.updateRole(organization.id, member.id, next);
      await queryClient.invalidateQueries({ queryKey: keys.members(organization.id) });
      toast.success(`${member.user.name} is now ${next}`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const remove = async (member: Member) => {
    try {
      await auth.organizations.members.remove(organization.id, member.id);
      await queryClient.invalidateQueries({ queryKey: keys.members(organization.id) });
      toast.success(`${member.user.name} removed`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const cancelInvitation = async (id: string) => {
    try {
      await auth.organizations.members.cancelInvitation(id);
      await queryClient.invalidateQueries({ queryKey: keys.invitations(organization.id) });
      toast.success('Invitation canceled');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const pending = (invitations.data ?? []).filter((i) => i.status === 'pending');

  return (
    <div className="flex flex-col gap-4">
      {isAdmin ? (
        <Section title="Invite a member">
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void invite();
            }}
          >
            <Input
              type="email"
              required
              placeholder="name@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-xs"
            />
            <OptionSelect aria-label="Role" value={role} onValueChange={setRole} options={roleOptions} />
            <Button type="submit" className="h-8" disabled={inviting || !email.trim()}>
              <Icon name="user-plus" className="size-3.5" /> Invite
            </Button>
          </form>
        </Section>
      ) : null}
      <Section title="Members" description={members.data ? `${members.data.length} in this workspace` : undefined}>
        {members.isPending ? (
          <div className="flex flex-col gap-1">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ) : members.isError ? (
          <div className="text-xs text-destructive">{errorMessage(members.error)}</div>
        ) : (
          <table className="w-full text-xs">
            <tbody>
              {(members.data ?? []).map((member) => {
                const self = member.userId === user.id;
                const canEdit = isAdmin && !self && (member.role !== 'owner' || myRole === 'owner');

                return (
                  <tr key={member.id} className={TABLE_ROW}>
                    <td className={TABLE_CELL}>
                      <span className="flex items-center gap-2">
                        <Avatar size="sm">
                          {member.user.image ? <AvatarImage src={member.user.image} alt={member.user.name} /> : null}
                          <AvatarFallback>{initials(member.user.name)}</AvatarFallback>
                        </Avatar>
                        <span className="flex flex-col leading-tight">
                          <span className="font-medium">
                            {member.user.name}
                            {self ? <span className="ml-1 text-xs text-muted-foreground">(you)</span> : null}
                          </span>
                          <span className="text-xs text-muted-foreground">{member.user.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className={TABLE_CELL}>
                      {canEdit ? (
                        <OptionSelect
                          size="sm"
                          aria-label={`Role of ${member.user.name}`}
                          value={member.role}
                          onValueChange={(next) => void changeRole(member, next as MemberRole)}
                          options={roleOptions}
                        />
                      ) : (
                        <Badge variant="secondary">{member.role}</Badge>
                      )}
                    </td>
                    <td className={cn(TABLE_CELL, 'text-right')}>
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          onClick={() => setRemoving(member)}
                        >
                          Remove
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Section>
      {isAdmin ? (
        <Section title="Pending invitations">
          {pending.length === 0 ? (
            <div className="text-xs text-muted-foreground">No pending invitations.</div>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {pending.map((invitation) => (
                  <tr key={invitation.id} className={TABLE_ROW}>
                    <td className={TABLE_CELL}>{invitation.email}</td>
                    <td className={TABLE_CELL}>
                      <Badge variant="secondary">{invitation.role}</Badge>
                    </td>
                    <td className={cn(TABLE_CELL, 'text-xs text-muted-foreground')}>
                      {invitation.expiresAt ? `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}` : ''}
                    </td>
                    <td className={cn(TABLE_CELL, 'text-right')}>
                      <Button variant="ghost" size="sm" onClick={() => void cancelInvitation(invitation.id)}>
                        Cancel
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>
      ) : null}
      <AlertDialog open={Boolean(removing)} onOpenChange={(open) => !open && setRemoving(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.user.name}?</AlertDialogTitle>
            <AlertDialogDescription>They lose access to this workspace immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const member = removing;
                setRemoving(null);

                if (member) {
                  void remove(member);
                }
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const membersSection = defineSettingsSection({
  name: 'members',
  label: 'Members',
  icon: 'users',
  group: 'workspace',
  component: MembersSettings,
});
