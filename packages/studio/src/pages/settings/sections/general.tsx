import { defineSettingsSection } from '@devias/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  Section,
} from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { workspaceErrorMessage } from '../../../auth/pages/workspace-errors';
import { useAuth } from '../../../providers/auth';
import { useWorkspace } from '../../../providers/workspace';
import { keys } from '../../../query/keys';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';
import { clearAuthCache } from '../../../router/session-cache';

/**
 * Deleting the workspace: owners only, and only after typing its address, since it takes every record, workflow and
 * conversation with it and cannot be undone.
 */
function DeleteWorkspace() {
  const auth = useAuth();
  const { organization } = useWorkspace();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const confirmed = typed.trim() === organization.slug;

  const remove = async () => {
    if (!confirmed) {
      return;
    }

    setDeleting(true);

    try {
      await auth.organizations.delete(organization.id);
      clearAuthCache();
      queryClient.clear();
      toast.success(`Deleted ${organization.name}`);
      navigation.navigate(links.workspaces(), { replace: true });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the workspace');
      setDeleting(false);
    }
  };

  return (
    <Section
      title="Delete workspace"
      description="Removes the workspace with its records, workflows, modules and agent conversations. This cannot be undone."
    >
      <Button
        variant="destructive"
        size="sm"
        onClick={() => {
          setTyped('');
          setOpen(true);
        }}
      >
        <Icon name="trash-2" className="size-3.5" /> Delete this workspace
      </Button>
      <Dialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void remove();
            }}
          >
            <DialogHeader>
              <DialogTitle>Delete {organization.name}?</DialogTitle>
              <DialogDescription>
                Everyone in it loses access, and every record, workflow, module setting and conversation is removed for
                good. Type <span className="font-mono text-foreground">{organization.slug}</span> to confirm.
              </DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Workspace address"
              autoComplete="off"
              autoFocus
              value={typed}
              placeholder={organization.slug}
              onChange={(event) => setTyped(event.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={deleting} onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={!confirmed || deleting}>
                {deleting ? 'Deleting…' : 'Delete workspace'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </Section>
  );
}

function GeneralSettings() {
  const auth = useAuth();
  const { organization, isAdmin, role } = useWorkspace();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const [name, setName] = useState(organization.name);
  const [slug, setSlug] = useState(organization.slug);
  const [saving, setSaving] = useState(false);
  const dirty = name !== organization.name || slug !== organization.slug;

  const save = async () => {
    setSaving(true);

    try {
      const updated = await auth.organizations.update(organization.id, { name: name.trim(), slug: slug.trim() });
      clearAuthCache();
      await queryClient.invalidateQueries({ queryKey: keys.organizations() });
      toast.success('Workspace updated');

      if (updated.slug !== organization.slug) {
        navigation.navigate(links.settings(updated.slug, 'general'), { replace: true });
      }
    } catch (error) {
      toast.error(workspaceErrorMessage(error, slug.trim(), 'Could not update the workspace'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section title="Workspace" description="Name and URL slug.">
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="ws-name">Name</FieldLabel>
            <Input id="ws-name" value={name} disabled={!isAdmin} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="ws-slug">Slug</FieldLabel>
            <Input id="ws-slug" value={slug} disabled={!isAdmin} onChange={(e) => setSlug(e.target.value)} />
            <FieldDescription>Used in URLs: /workspaces/{slug || '…'}</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="ws-id">ID</FieldLabel>
            <div className="flex gap-2">
              <Input
                id="ws-id"
                value={organization.id}
                readOnly
                className="font-mono"
                onFocus={(e) => e.target.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Copy the workspace ID"
                onClick={() => {
                  void navigator.clipboard
                    ?.writeText(organization.id)
                    .then(() => toast.success('ID copied'))
                    .catch(() => toast.error('Could not copy'));
                }}
              >
                <Icon name="copy" />
              </Button>
            </div>
            <FieldDescription>For the API, scripts and support. It never changes.</FieldDescription>
          </Field>
          {isAdmin ? (
            <Button
              size="sm"
              className="self-start"
              disabled={!dirty || saving || !name.trim() || !slug.trim()}
              onClick={() => void save()}
            >
              Save
            </Button>
          ) : null}
        </FieldGroup>
      </Section>
      {role === 'owner' ? <DeleteWorkspace /> : null}
    </div>
  );
}

export const generalSection = defineSettingsSection({
  name: 'general',
  label: 'General',
  icon: 'settings',
  group: 'workspace',
  component: GeneralSettings,
});
