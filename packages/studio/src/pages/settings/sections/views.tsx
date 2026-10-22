import { defineSettingsSection, type ViewMetadata } from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  OptionSelect,
} from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../../hooks/use-mutations';
import { useClient } from '../../../providers/client';
import { useSchema } from '../../../providers/schema';
import { useStudioConfig } from '../../../providers/studio-config';
import { keys } from '../../../query/keys';

function ViewDialog({
  objectId,
  existing,
  onClose,
}: {
  objectId: string;
  existing?: ViewMetadata;
  onClose: () => void;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const config = useStudioConfig();
  const [name, setName] = useState(existing?.label ?? '');
  const [type, setType] = useState(existing?.type ?? 'table');
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);

    try {
      if (existing) {
        await client.metadata.views.update(existing.id, { label: name.trim() });
      } else {
        await client.metadata.views.create({ objectId, label: name.trim(), type });
      }

      await queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });
      toast.success(existing ? 'View renamed' : 'View created');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{existing ? 'Rename view' : 'New view'}</DialogTitle>
          <DialogDescription>
            {existing ? 'Change the name shown in the view switcher.' : 'Pick a name and a view type.'}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-3">
          <Field>
            <FieldLabel htmlFor="view-name">Name</FieldLabel>
            <Input id="view-name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
          </Field>
          {!existing ? (
            <Field>
              <FieldLabel htmlFor="view-type">Type</FieldLabel>
              <OptionSelect
                id="view-type"
                className="w-full"
                value={type}
                onValueChange={setType}
                options={[...config.registries.viewTypes.values()].map((t) => ({
                  value: t.type,
                  label: t.label,
                  icon: t.icon,
                }))}
              />
            </Field>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving || !name.trim()} onClick={() => void submit()}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ViewsSettings() {
  const { schema, index } = useSchema();
  const client = useClient();
  const queryClient = useQueryClient();
  const config = useStudioConfig();
  const [objectId, setObjectId] = useState(schema.objects[0]?.id ?? '');
  const object = index.objectsById.get(objectId) ?? schema.objects[0];
  const views = object ? (index.viewsByObjectId.get(object.id) ?? []) : [];
  const [dialog, setDialog] = useState<{ existing?: ViewMetadata } | null>(null);
  const [deleting, setDeleting] = useState<ViewMetadata | null>(null);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });

  const run = async (work: () => Promise<unknown>, success: string) => {
    try {
      await work();
      await invalidate();
      toast.success(success);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const setDefault = (view: ViewMetadata) =>
    run(async () => {
      for (const other of views.filter((v) => v.isDefault && v.id !== view.id)) {
        await client.metadata.views.update(other.id, { isDefault: false });
      }

      await client.metadata.views.update(view.id, { isDefault: true });
    }, `${view.label} is now the default`);
  const move = (view: ViewMetadata, delta: number) => {
    const sorted = [...views].sort((a, b) => a.position - b.position);
    const from = sorted.findIndex((v) => v.id === view.id);
    const to = from + delta;
    const other = sorted[to];

    if (!other) {
      return;
    }

    return run(async () => {
      await client.metadata.views.update(view.id, { position: to });
      await client.metadata.views.update(other.id, { position: from });
    }, 'Views reordered');
  };

  const ordered = [...views].sort((a, b) => a.position - b.position);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">
        Saved layouts of each object: columns, filters, sorting and grouping. The default opens first; the others are
        tabs on the object's page.
      </p>
      <div className="grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)]">
        <nav aria-label="Objects" className="flex flex-col gap-0.5 md:sticky md:top-0 md:self-start">
          {schema.objects.map((o) => {
            const active = o.id === object?.id;

            return (
              <button
                key={o.id}
                type="button"
                aria-current={active ? 'true' : undefined}
                onClick={() => setObjectId(o.id)}
                className={cn(
                  'flex h-8 w-full items-center gap-2 rounded-sm px-2 text-left text-xs transition-colors hover:bg-muted',
                  active ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon name={o.icon ?? 'box'} className="size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{o.labelPlural}</span>
                <span className="shrink-0 tabular-nums">{index.viewsByObjectId.get(o.id)?.length ?? 0}</span>
              </button>
            );
          })}
        </nav>
        {object ? (
          <section className="flex min-w-0 flex-col gap-3" aria-label={`${object.labelPlural} views`}>
            <div className="flex min-h-8 items-center justify-between gap-3">
              <h2 className="truncate font-heading text-sub">{object.labelPlural}</h2>
              <Button size="sm" variant="outline" onClick={() => setDialog({})}>
                <Icon name="plus" className="size-3.5" /> New view
              </Button>
            </div>
            {ordered.length === 0 ? (
              <EmptyState
                icon={object.icon ?? 'table'}
                title="No saved views"
                description={`${object.labelPlural} open in a table with every field until you add a view.`}
              />
            ) : (
              <ul className="flex flex-col rounded-lg bg-card p-1 ring-1 ring-card-border">
                {ordered.map((view, i) => (
                  <li
                    key={view.id}
                    data-slot="view-row"
                    className="group flex h-11 items-center gap-3 rounded-xs px-3 transition-colors hover:bg-muted"
                  >
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground group-hover:bg-background">
                      <Icon name={view.icon ?? 'table'} className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">{view.label}</span>
                    {view.isDefault ? <Badge variant="secondary">Default</Badge> : null}
                    <span className="w-20 shrink-0 truncate text-xs text-muted-foreground">
                      {config.registries.viewTypes.get(view.type)?.label ?? view.type}
                    </span>
                    <span
                      className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground sm:block"
                      title="Added by"
                    >
                      {view.moduleId ?? 'Workspace'}
                    </span>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`View actions for ${view.label}`}
                            className="text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
                          />
                        }
                      >
                        <Icon name="more-horizontal" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem disabled={view.isDefault} onClick={() => void setDefault(view)}>
                          <Icon name="star" /> Set as default
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setDialog({ existing: view })}>
                          <Icon name="pencil" /> Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={i === 0} onClick={() => void move(view, -1)}>
                          <Icon name="arrow-up" /> Move up
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled={i === ordered.length - 1} onClick={() => void move(view, 1)}>
                          <Icon name="arrow-down" /> Move down
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="destructive" onClick={() => setDeleting(view)}>
                          <Icon name="trash-2" /> Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
      {dialog && object ? (
        <ViewDialog objectId={object.id} existing={dialog.existing} onClose={() => setDialog(null)} />
      ) : null}
      <AlertDialog open={Boolean(deleting)} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{deleting?.label}"?</AlertDialogTitle>
            <AlertDialogDescription>Records are not affected; only the saved view is removed.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const view = deleting;
                setDeleting(null);

                if (view) {
                  void run(() => client.metadata.views.delete(view.id), 'View deleted');
                }
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const viewsSection = defineSettingsSection({
  name: 'views',
  label: 'Views',
  icon: 'table',
  group: 'data',
  requiresRole: 'admin',
  component: ViewsSettings,
});
