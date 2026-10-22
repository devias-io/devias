import { defineSettingsSection, type ModuleManifest, type PlanResult } from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  EmptyState,
  Icon,
  Input,
  Skeleton,
  UnderlineTabs,
} from '@devias/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { ModuleMark } from '../../../components/module-mark';
import { useModuleCatalog, useOAuthReturn, useRuntimeModules } from '../../../hooks/use-module-connections';
import { errorMessage } from '../../../hooks/use-mutations';
import { useClient } from '../../../providers/client';
import { useSchema } from '../../../providers/schema';
import { useWorkspace } from '../../../providers/workspace';
import { keys } from '../../../query/keys';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';
import { driftOf, useManifestDrift } from '../../../shell/drift-banner';
import { type ModuleEntry, ModulePage, statusOf } from './module-page';
import { plural } from './plan-diff';

export { PlanDiffViewer } from './plan-diff';

/** What the card's button says: the next thing to do with the module. */
const actionLabel = (entry: ModuleEntry): string => {
  if (entry.status === 'not_installed') {
    return 'Install';
  }

  if (entry.status === 'update_available') {
    return 'Update';
  }

  if (entry.runtime && statusOf(entry).label === 'Not connected') {
    return 'Connect';
  }

  return 'Manage';
};

/** A module as a card; the whole card opens it, its button only says what opening it is for. */
function ModuleCard({ entry, onOpen }: { entry: ModuleEntry; onOpen: () => void }) {
  const { label, dot } = statusOf(entry);
  const updating = entry.status === 'update_available';
  const primary = entry.status === 'not_installed' || actionLabel(entry) === 'Connect' || updating;

  return (
    <li data-module={entry.id} className="min-w-0">
      <button
        type="button"
        aria-label={`Open ${entry.name}`}
        className={cn(
          'flex h-full w-full flex-col gap-3 rounded-lg border bg-card p-4 text-left transition-colors hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
          // A module with changes waiting gets a soft lime edge, a nod to the strip above it.
          updating ? 'border-brand/50' : 'border-border',
        )}
        onClick={onOpen}
      >
        <span className="flex items-center gap-3">
          <ModuleMark moduleId={entry.id} module={entry.manifest ?? entry.installed} tile className="size-10" />
          <span className="flex min-w-0 flex-col">
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate text-xs font-medium">{entry.name}</span>
              {entry.core ? (
                <span className="shrink-0 rounded-sm border border-border px-1.5 text-xs text-muted-foreground">
                  Core
                </span>
              ) : null}
            </span>
            {entry.publisher ? (
              <span className="truncate text-xs text-muted-foreground">{entry.publisher.name}</span>
            ) : null}
          </span>
        </span>
        <span className="line-clamp-2 min-h-10 text-xs text-muted-foreground">{entry.description}</span>
        <span className="mt-auto flex items-center justify-between gap-2">
          <span
            className={cn('flex items-center gap-1.5 text-xs', updating ? 'text-foreground' : 'text-muted-foreground')}
          >
            <span className={cn('size-1.5 rounded-full', updating ? 'bg-brand' : dot)} />
            {label}
          </span>
          <span
            className={cn(
              'inline-flex h-7 items-center rounded-lg px-2.5 text-xs font-medium',
              primary
                ? 'bg-brand text-brand-foreground dark:bg-primary dark:text-primary-foreground'
                : 'border border-border text-foreground',
            )}
          >
            {actionLabel(entry)}
          </span>
        </span>
      </button>
    </li>
  );
}

type Filter = 'all' | 'installed' | 'available';

function ModulesSettings() {
  const client = useClient();
  const queryClient = useQueryClient();
  const drift = useManifestDrift();
  const { schema } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const catalog = useModuleCatalog();
  const runtime = useRuntimeModules();
  useOAuthReturn();
  const installed = useQuery({
    queryKey: keys.modules(client.workspaceId),
    queryFn: () => client.modules.list(),
  });
  const [plans, setPlans] = useState<Record<string, PlanResult>>({});
  const [allowDestructive, setAllowDestructive] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [uninstalling, setUninstalling] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });
    await queryClient.invalidateQueries({ queryKey: keys.modules(client.workspaceId) });
  };
  const dismiss = (id: string) =>
    setPlans((p) => {
      const next = { ...p };
      delete next[id];

      return next;
    });
  const plan = async (manifest: ModuleManifest) => {
    setBusy(manifest.id);

    try {
      const result = await client.modules.plan(manifest);
      setPlans((p) => ({ ...p, [manifest.id]: result }));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };
  const apply = async (manifest: ModuleManifest): Promise<boolean> => {
    const current = plans[manifest.id];

    if (!current) {
      return false;
    }

    setBusy(manifest.id);

    try {
      const result = await client.modules.apply(manifest, {
        expectedPlanHash: current.planHash,
        allowDestructive: Boolean(allowDestructive[manifest.id]),
      });
      const name = manifest.name;
      toast.success(
        result.applied.length > 0
          ? `Applied ${name}: ${plural(result.applied.length, 'change')}`
          : `${current.fromVersion === null ? 'Installed' : 'Updated'} ${name}`,
      );
      dismiss(manifest.id);
      await refresh();

      return true;
    } catch (error) {
      toast.error(errorMessage(error));

      return false;
    } finally {
      setBusy(null);
    }
  };
  const uninstall = async (moduleId: string) => {
    setBusy(moduleId);

    try {
      const result = await client.modules.uninstall(moduleId, { allowDestructive: true });
      toast.success(`Uninstalled ${moduleId}: ${plural(result.applied.length, 'change')}`);
      dismiss(moduleId);
      await refresh();
      navigation.navigate(links.settings(slug, 'modules'));
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(null);
    }
  };

  // Compiled-in manifests first, then what only the server ships (outside services, say), then installed leftovers.
  const compiledIds = new Set(drift.map((d) => d.manifest.id));
  const serverOnly = (catalog.data ?? [])
    .filter((manifest) => !compiledIds.has(manifest.id))
    .map((manifest) => driftOf(manifest, schema.modules));
  const available = [...drift, ...serverOnly];
  const availableIds = new Set(available.map((d) => d.manifest.id));
  const orphaned = (installed.data ?? []).filter((e) => !availableIds.has(e.moduleId));
  const runtimeOf = (moduleId: string) => runtime.items.find((item) => item.module.moduleId === moduleId);

  const entries: ModuleEntry[] = [
    ...available.map(({ manifest, status, hash, installedHash }): ModuleEntry => {
      const row = installed.data?.find((e) => e.moduleId === manifest.id);

      return {
        id: manifest.id,
        name: manifest.name,
        description: manifest.description ?? row?.description,
        version: manifest.version ?? row?.version,
        publisher: manifest.publisher ?? row?.publisher,
        core: manifest.core || row?.core || false,
        manifest,
        installed: row,
        status,
        hash,
        installedHash,
        runtime: status === 'not_installed' ? undefined : runtimeOf(manifest.id),
      };
    }),
    ...orphaned.map(
      (module): ModuleEntry => ({
        id: module.moduleId,
        name: module.name,
        description: module.description,
        version: module.version,
        publisher: module.publisher,
        core: module.core || false,
        installed: module,
        status: 'not_compiled',
        runtime: runtimeOf(module.moduleId),
      }),
    ),
  ];
  const itemId = navigation.params.item;
  const open = itemId ? entries.find((entry) => entry.id === itemId) : undefined;

  const isAvailable = (entry: ModuleEntry) => entry.status === 'not_installed';
  const needle = query.trim().toLowerCase();
  const shown = entries.filter(
    (entry) =>
      (filter === 'all' || (filter === 'available') === isAvailable(entry)) &&
      (!needle ||
        `${entry.name} ${entry.description ?? ''} ${entry.publisher?.name ?? ''}`.toLowerCase().includes(needle)),
  );

  const listView = (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-muted-foreground">Add data, tools and outside services to this workspace.</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <UnderlineTabs
          variant="pill"
          aria-label="Filter modules"
          value={filter}
          onValueChange={(id) => setFilter(id as Filter)}
          tabs={[
            { id: 'all', label: 'All', count: entries.length },
            { id: 'installed', label: 'Installed', count: entries.filter((e) => !isAvailable(e)).length },
            { id: 'available', label: 'Available', count: entries.filter(isAvailable).length },
          ]}
        />
        <div className="relative w-full sm:w-64">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules"
            aria-label="Search modules"
            className="pl-8"
          />
        </div>
      </div>
      {shown.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" aria-label="Modules">
          {shown.map((entry) => (
            <ModuleCard
              key={entry.id}
              entry={entry}
              onOpen={() => navigation.navigate(links.settings(slug, 'modules', entry.id))}
            />
          ))}
        </ul>
      ) : (
        <p className="py-8 text-center text-xs text-muted-foreground">No modules match.</p>
      )}
    </div>
  );
  const pageView = open ? (
    <ModulePage
      key={open.id}
      entry={open}
      plan={plans[open.id]}
      busy={busy === open.id}
      allowDestructive={Boolean(allowDestructive[open.id])}
      onPlan={() => open.manifest && void plan(open.manifest)}
      onApply={() => (open.manifest ? apply(open.manifest) : Promise.resolve(false))}
      onAllowDestructive={(allow) => setAllowDestructive((a) => ({ ...a, [open.id]: allow }))}
      onUninstall={() => setUninstalling(open.id)}
    />
  ) : installed.isPending || catalog.isPending ? (
    <div className="flex flex-col gap-3 p-8">
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-4 w-96" />
      <Skeleton className="h-40 w-full" />
    </div>
  ) : (
    <EmptyState
      icon="circle-help"
      title="Unknown module"
      description={`No module named "${itemId}".`}
      action={
        <Button variant="outline" onClick={() => navigation.navigate(links.settings(slug, 'modules'))}>
          Back to modules
        </Button>
      }
    />
  );

  return (
    <>
      {itemId ? pageView : listView}
      <AlertDialog open={Boolean(uninstalling)} onOpenChange={(open) => !open && setUninstalling(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Uninstall {entries.find((entry) => entry.id === uninstalling)?.name ?? uninstalling}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Every object, field, view and layout owned by the module is removed, including their records, along with
              its connections, variables and the events it delivered. Workspace-owned entities stay.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const id = uninstalling;
                setUninstalling(null);

                if (id) {
                  void uninstall(id);
                }
              }}
            >
              Uninstall
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export const modulesSection = defineSettingsSection({
  name: 'modules',
  label: 'Modules',
  icon: 'puzzle',
  group: 'workspace',
  requiresRole: 'admin',
  detail: true,
  component: ModulesSettings,
});
