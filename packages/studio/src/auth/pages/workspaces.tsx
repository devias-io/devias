import { Button, Field, FieldDescription, FieldGroup, FieldLabel, Icon, Input, Skeleton } from '@devias/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../providers/auth';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { clearAuthCache, rememberActiveOrganization } from '../../router/session-cache';
import { AuthLayout, slugify } from './auth-layout';
import { workspaceErrorMessage } from './workspace-errors';

export function WorkspacesPage() {
  const auth = useAuth();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const organizations = useQuery({ queryKey: keys.organizations(), queryFn: () => auth.organizations.list() });
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const open = async (organizationId: string, organizationSlug: string) => {
    try {
      await auth.organizations.setActive({ organizationId });
      rememberActiveOrganization(organizationId);
      navigation.navigate(links.workspace(organizationSlug));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open the workspace');
    }
  };

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);

    try {
      const organization = await auth.organizations.create({ name: name.trim(), slug: slug.trim() });
      clearAuthCache();
      await queryClient.invalidateQueries({ queryKey: keys.organizations() });
      await open(organization.id, organization.slug);
    } catch (error) {
      toast.error(workspaceErrorMessage(error, slug.trim(), 'Could not create the workspace'));
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await auth.signOut();
    clearAuthCache();
    queryClient.clear();
    navigation.navigate(links.signIn());
  };

  const list = organizations.data ?? [];
  const creating = showCreate || (organizations.isSuccess && list.length === 0);

  return (
    <AuthLayout
      title="Choose a workspace"
      description="Open one of yours, or create a new workspace."
      wide
      panel={false}
      footer={
        <button type="button" className="hover:text-foreground" onClick={() => void signOut()}>
          Sign out
        </button>
      }
    >
      {organizations.isPending ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : list.length > 0 ? (
        <ul className="mb-4 flex flex-col gap-2">
          {list.map((org) => (
            <li key={org.id}>
              <button
                type="button"
                className="flex h-14 w-full items-center gap-3 rounded-lg border border-border bg-card px-4 text-left text-xs transition-colors hover:bg-muted/50"
                onClick={() => void open(org.id, org.slug)}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand text-xs font-semibold text-brand-foreground">
                  {org.name.slice(0, 1).toUpperCase()}
                </span>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-medium">{org.name}</span>
                  <span className="truncate text-xs text-muted-foreground">/workspaces/{org.slug}</span>
                </span>
                <Icon name="chevron-right" className="ml-auto size-4 text-muted-foreground" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {creating ? (
        <form onSubmit={(e) => void create(e)} className="flex flex-col gap-5 border-t border-border pt-5">
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="ws-name">Workspace name</FieldLabel>
              <Input
                id="ws-name"
                required
                autoFocus
                value={name}
                onChange={(e) => {
                  setName(e.target.value);

                  if (!slugTouched) {
                    setSlug(slugify(e.target.value));
                  }
                }}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ws-slug">Slug</FieldLabel>
              <Input
                id="ws-slug"
                required
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
              />
              <FieldDescription>Used in URLs: /workspaces/{slug || '…'}</FieldDescription>
            </Field>
          </FieldGroup>
          <div className="flex items-center gap-2">
            <Button type="submit" className="h-10" disabled={busy || !name.trim() || !slug.trim()}>
              Create workspace
            </Button>
            {list.length > 0 ? (
              <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>
      ) : (
        <Button variant="outline" className="h-10 w-full" onClick={() => setShowCreate(true)}>
          <Icon name="plus" className="size-3.5" /> New workspace
        </Button>
      )}
    </AuthLayout>
  );
}
