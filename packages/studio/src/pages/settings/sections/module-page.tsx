import type { InstalledModule, ModuleManifest, PlanResult } from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Breadcrumbs,
  Button,
  Checkbox,
  cn,
  Icon,
  Label,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@devias/ui';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ModuleMark } from '../../../components/module-mark';
import { type RuntimeModule, useModuleVariables } from '../../../hooks/use-module-connections';
import { useWorkflows } from '../../../hooks/use-workflows';
import { useWorkspace } from '../../../providers/workspace';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';
import type { ManifestDrift } from '../../../shell/drift-banner';
import { ModulePolicies } from './module-consent';
import { ModuleConnections, ModuleWorkflows, runtimeStatusOf, runtimeSummary, WebhookEvents } from './module-runtime';
import { PlanDiffViewer, planSentence, plural } from './plan-diff';

export type Status = ManifestDrift['status'] | 'not_compiled';

export const STATUS: Record<Status, { label: string; dot: string }> = {
  installed: { label: 'Up to date', dot: 'bg-muted-foreground' },
  update_available: { label: 'Update available', dot: 'bg-warning' },
  not_installed: { label: 'Not installed', dot: 'border border-muted-foreground' },
  not_compiled: { label: 'Not in this build', dot: 'border border-muted-foreground' },
};

/** An address as the page shows it: its host, without `www.`; the address itself when it does not parse. */
const hostOf = (address: string): string => {
  try {
    return new URL(address).host.replace(/^www\./, '');
  } catch {
    return address;
  }
};

/** One module as the list and its page see it: the manifest this build ships, what is installed, and its state. */
export interface ModuleEntry {
  id: string;
  name: string;
  description?: string;
  version?: string;
  core: boolean;
  manifest?: ModuleManifest;
  installed?: InstalledModule;
  status: Status;
  hash?: string;
  installedHash?: string;
  /** Connections, variables, webhook and events, for an installed module that declares any. */
  runtime?: RuntimeModule;
}

/** The label and dot a module shows in the list: setup trouble outranks "up to date". */
export const statusOf = (entry: ModuleEntry): { label: string; dot: string } => {
  if (entry.runtime && entry.status === 'installed') {
    const status = runtimeStatusOf(entry.runtime);

    if (status === 'unconfigured') {
      return { label: 'Not connected', dot: 'bg-warning' };
    }

    if (status === 'error') {
      return { label: 'Needs attention', dot: 'bg-destructive' };
    }
  }

  return STATUS[entry.status];
};

/** What a module brings, as counts. */
const contentsOf = (manifest: ModuleManifest): [string, number][] =>
  (
    [
      ['Objects', manifest.objects.length],
      ['Views', manifest.views.length],
      ['Layouts', manifest.layouts.length],
      ['Commands', manifest.commandItems.length],
      ['Actions', manifest.actions.length],
      ['Workflows', manifest.workflows.length],
      ['Agents', manifest.agents.length],
      ['Events', manifest.events.length],
    ] as [string, number][]
  ).filter(([, count]) => count > 0);

type Tab = 'overview' | 'changes' | 'connections' | 'events' | 'workflows';

/** One thing left to do before a module works: install it, update it, connect it, look at its defaults. */
interface Step {
  key: string;
  title: string;
  detail?: string;
  done?: boolean;
  action?: { label: string; primary?: boolean; onClick: () => void };
}

/** What is left to do, as a soft panel at the top of the overview. It is gone once there is nothing left. */
function SetupPanel({ title, steps }: { title: string; steps: Step[] }) {
  const left = steps.filter((step) => !step.done).length;

  return (
    <section data-slot="module-setup" className="flex flex-col rounded-lg bg-muted/60 px-5 pt-4 pb-1.5">
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-xs text-muted-foreground">{left === 1 ? 'One step left.' : `${left} steps left.`}</p>
      <ol className="mt-2">
        {steps.map((step, index) => (
          <li
            key={step.key}
            data-step={step.key}
            className="grid grid-cols-[1.375rem_minmax(0,1fr)_auto] items-center gap-3 border-t border-foreground/10 py-3 first:border-t-0"
          >
            <span
              className={cn(
                'flex size-5 items-center justify-center rounded-full text-xs',
                step.done
                  ? 'bg-success text-brand-foreground'
                  : 'border-[1.5px] border-muted-foreground tabular-nums text-muted-foreground',
              )}
            >
              {step.done ? <Icon name="check" className="size-3.5" /> : index + 1}
            </span>
            <div className="min-w-0">
              <div className="font-medium">{step.title}</div>
              {step.detail ? <div className="text-xs text-muted-foreground">{step.detail}</div> : null}
            </div>
            {step.action ? (
              <Button size="sm" variant={step.action.primary ? 'default' : 'outline'} onClick={step.action.onClick}>
                {step.action.label}
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Changes waiting to be applied, as a soft panel at the top of the overview: what they are, and the way to the Changes tab. */
function ReviewPanel({ line, onReview }: { line: string; onReview: () => void }) {
  return (
    <section
      data-slot="module-review"
      className="flex items-center justify-between gap-4 rounded-lg bg-muted/60 px-5 py-4"
    >
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">Review changes</h3>
        <p className="text-xs text-muted-foreground">{line}</p>
      </div>
      <Button size="sm" onClick={onReview}>
        Review changes
      </Button>
    </section>
  );
}

/** One part of the overview: a small bold heading over its content, a hairline above every part but the first. */
function Part({ title, aside, id, children }: { title: string; aside?: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="flex flex-col gap-3 border-t border-border py-6 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-xs font-semibold">{title}</h3>
        {aside ? <span className="text-xs text-muted-foreground">{aside}</span> : null}
      </div>
      {children}
    </section>
  );
}

export interface ModulePageProps {
  entry: ModuleEntry;
  plan?: PlanResult;
  busy: boolean;
  allowDestructive: boolean;
  onPlan: () => void;
  /** Applies the plan; resolves to whether it went through. */
  onApply: () => Promise<boolean>;
  onAllowDestructive: (allow: boolean) => void;
  onUninstall: () => void;
}

/**
 * A module's page in Settings: what it is and whether it works, with what is left to do first, then what it adds,
 * the access it asks for and its details; what applying it changes, its connections, its events and its workflows are tabs.
 */
export function ModulePage({
  entry,
  plan,
  busy,
  allowDestructive,
  onPlan,
  onApply,
  onAllowDestructive,
  onUninstall,
}: ModulePageProps) {
  const { manifest, installed, runtime, status } = entry;
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const listHref = links.settings(slug, 'modules');
  const pageHref = links.settings(slug, 'modules', entry.id);
  const [tab, setTab] = useState<Tab>(() => {
    const asked = navigation.search.tab;

    return typeof asked === 'string' && asked ? (asked as Tab) : 'overview';
  });
  const [confirming, setConfirming] = useState(false);
  const go = (next: Tab) => {
    setTab(next);
    navigation.navigate(next === 'overview' ? pageHref : `${pageHref}?tab=${next}`, { replace: true });
  };
  const installedHere = status !== 'not_installed';
  const hasConnections = Boolean(
    runtime && (runtime.module.connections.length > 0 || runtime.module.variables.length > 0),
  );
  const hasEvents = Boolean(runtime && runtime.module.events.length > 0);
  // The workflows a module comes with are the workspace's own rows, so they are asked for rather than declared.
  const shipped = useWorkflows();
  const hasWorkflows = Boolean(runtime && shipped.data?.some((workflow) => workflow.moduleId === runtime.module.id));
  const variables = useModuleVariables(
    entry.id,
    installedHere && Boolean(runtime && runtime.module.variables.length > 0),
  );
  const pending = status === 'not_installed' ? 'install' : status === 'update_available' ? 'update' : undefined;
  const { label, dot } = statusOf(entry);

  // The plan is only fetched once someone looks at it, and asked for once: a failure is not retried in a loop.
  const asked = useRef(false);
  useEffect(() => {
    if (plan) {
      asked.current = false;

      return;
    }

    if (tab === 'changes' && manifest && !busy && !asked.current) {
      asked.current = true;
      onPlan();
    }
  }, [tab, manifest, plan, busy, onPlan]);

  const tabs: { id: Tab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    ...(manifest ? [{ id: 'changes' as const, label: pending === 'install' ? 'Install' : 'Changes' }] : []),
    ...(installedHere && hasConnections ? [{ id: 'connections' as const, label: 'Connections' }] : []),
    ...(installedHere && hasEvents ? [{ id: 'events' as const, label: 'Events' }] : []),
    ...(installedHere && hasWorkflows ? [{ id: 'workflows' as const, label: 'Workflows' }] : []),
  ];
  // A link to a tab the module does not have (or not any more) shows the overview.
  const shown: Tab = tabs.some((candidate) => candidate.id === tab) ? tab : 'overview';

  const changed = Boolean(pending) || (plan ? plan.changes.some((change) => change.action !== 'noop') : false);
  const blocked = plan ? plan.hasConflicts || (plan.hasDestructive && !allowDestructive) : true;
  const contents = manifest ? contentsOf(manifest) : [];
  // What is in effect where it is installed, otherwise what installing would ask for.
  const declared = installed ?? manifest;
  const policies = declared?.policies ?? [];

  // What is left to do before it works.
  const unsetVariables = (variables.data ?? []).filter((variable) => variable.required && variable.source === 'unset');
  const needsVariables = installedHere && unsetVariables.length > 0;
  const needsConnect = installedHere && hasConnections && runtime !== undefined && runtimeStatusOf(runtime) !== 'ready';
  const provider = runtime?.module.connections[0];
  const refused = runtime?.connections.find((connection) => connection.status === 'auth_failed');
  const steps: Step[] = [];

  if (status === 'not_installed') {
    steps.push({
      key: 'install',
      title: 'Review and install',
      detail: 'Nothing changes until you install it.',
      action: { label: 'Review install', primary: true, onClick: () => go('changes') },
    });
  } else if (status !== 'not_compiled') {
    steps.push({
      key: 'installed',
      title: 'Installed',
      detail: installed?.version ? `v${installed.version}` : undefined,
      done: true,
    });

    if (needsVariables) {
      steps.push({
        key: 'variables',
        title: `Set ${unsetVariables.map((variable) => variable.label).join(' and ')}`,
        detail: 'It cannot work until these are set in its Variables.',
        action: { label: 'Set variables', primary: true, onClick: () => go('connections') },
      });
    }

    if (needsConnect) {
      steps.push({
        key: 'connect',
        title: refused ? 'Reconnect' : `Connect ${provider?.label ?? entry.name}`,
        detail: refused
          ? (refused.lastError ?? 'A connection was refused.')
          : (provider?.help ??
            (provider?.kind === 'oauth2' ? 'Sign in to the account it works with.' : 'Add the credentials it needs.')),
        action: { label: refused ? 'Reconnect' : 'Connect', primary: true, onClick: () => go('connections') },
      });
    }

    if (steps.some((step) => !step.done) && policies.length > 0) {
      const first = policies[0]?.description;
      steps.push({
        key: 'defaults',
        title: 'Check the defaults',
        detail: policies.length > 1 ? `${first} and ${policies.length - 1} more.` : first,
        action: {
          label: 'Review',
          onClick: () => document.getElementById('module-defaults')?.scrollIntoView({ behavior: 'smooth' }),
        },
      });
    }
  }

  const settingUp = steps.some((step) => !step.done);
  const setupTitle = status === 'not_installed' ? `Install ${entry.name}` : `Finish setting up ${entry.name}`;
  // The version the module is at here; while changes wait, the one they lead to as well.
  const versionLine =
    status === 'update_available' && installed?.version && manifest?.version && installed.version !== manifest.version
      ? `v${installed.version} → v${manifest.version}`
      : (installed?.version ?? entry.version)
        ? `v${installed?.version ?? entry.version}`
        : null;
  // Changes waiting to be applied: told in a bar across the top, not among the steps.
  const updateLine =
    installed?.version && manifest?.version && installed.version !== manifest.version
      ? `Update available: v${installed.version} → v${manifest.version}`
      : 'This module has changes to apply';

  // Applying what the changes tab shows: a bar at the bottom of that tab, not a button in the header.
  const action =
    shown === 'changes' && changed && plan
      ? {
          label: status === 'not_installed' ? 'Install' : 'Apply changes',
          disabled: busy || blocked,
          hint: plan.hasConflicts
            ? 'Resolve the conflicts first.'
            : plan.hasDestructive && !allowDestructive
              ? 'Confirm above that removing data is intended.'
              : null,
          // Asks first: applying changes the workspace's data model.
          onClick: () => setConfirming(true),
        }
      : null;

  return (
    <Tabs className="flex-1 gap-0" value={shown} onValueChange={(value) => go(value as Tab)}>
      {status === 'update_available' ? (
        <div data-slot="module-update" className="bg-brand text-brand-foreground">
          <p className="mx-auto flex w-full max-w-[90rem] h-8 items-center justify-center gap-3 px-6 font-mono text-[12px] sm:px-10">
            <Icon name="flag" className="size-3.5 shrink-0 fill-current" />
            <span className="min-w-0 truncate font-medium">{updateLine}.</span>
          </p>
        </div>
      ) : null}
      <div className="border-b border-border" data-slot="module-header" data-module-page={entry.id}>
        <div className="mx-auto w-full max-w-[90rem] px-6 pt-5 sm:px-10">
          <Breadcrumbs
            items={[{ label: 'Modules', href: listHref }, { label: entry.name }]}
            linkComponent={navigation.Link}
            className="-ml-1"
          />
          <div className="mt-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-4">
            <div className="flex min-w-0 items-center gap-4">
              <ModuleMark moduleId={entry.id} module={manifest ?? installed} tile className="size-14" />
              <div className="min-w-0">
                <h1 className="flex items-center gap-2 font-heading text-heading">
                  <span className="truncate">{entry.name}</span>
                  {entry.core ? (
                    <span
                      className="shrink-0 rounded-sm border border-border px-1.5 font-sans text-xs font-normal text-muted-foreground"
                      title="Part of the product; cannot be uninstalled"
                    >
                      Core
                    </span>
                  ) : null}
                </h1>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                  <span className={cn('size-1.5 rounded-full', dot)} />
                  {label}
                  {versionLine ? <span>· {versionLine}</span> : null}
                </p>
              </div>
            </div>
          </div>
          {entry.description ? <p className="mt-4 text-muted-foreground">{entry.description}</p> : null}
          {tabs.length > 1 ? (
            <TabsList variant="underline" className="mt-6" aria-label="Module">
              {tabs.map((candidate) => (
                <TabsTrigger key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </TabsTrigger>
              ))}
            </TabsList>
          ) : (
            <div className="h-6" />
          )}
        </div>
      </div>
      <div className="@container mx-auto w-full max-w-[90rem] flex-1 px-6 pt-8 pb-12 sm:px-10">
        <div>
          <TabsContent value="overview">
            <div className="grid gap-x-14 gap-y-8 @6xl:grid-cols-[minmax(0,1fr)_22rem]" data-slot="module-overview">
              <div className="flex min-w-0 flex-col gap-6">
                {status === 'update_available' ? (
                  <ReviewPanel
                    line={`${versionLine ?? 'A newer version'} is ready. See what it changes before you apply it.`}
                    onReview={() => go('changes')}
                  />
                ) : null}
                {settingUp ? <SetupPanel title={setupTitle} steps={steps} /> : null}
                <div className="flex flex-col">
                  {contents.length > 0 ? (
                    <Part title="What it adds">
                      <dl data-slot="module-adds" className="grid grid-cols-2 gap-x-6 gap-y-4 @2xl:flex @2xl:gap-0">
                        {contents.map(([name, count]) => (
                          <div
                            key={name}
                            className="@2xl:border-l @2xl:border-border @2xl:px-7 @2xl:first:border-l-0 @2xl:first:pl-0"
                          >
                            <dt className="text-xs text-muted-foreground">{name}</dt>
                            <dd className="text-lg font-semibold tabular-nums">{count}</dd>
                          </div>
                        ))}
                      </dl>
                    </Part>
                  ) : null}
                  {runtime && !needsConnect && (hasConnections || hasEvents) ? (
                    <Part title="Connection">
                      <p className="text-muted-foreground">
                        {runtimeSummary(runtime)}
                        {runtimeStatusOf(runtime) === 'error'
                          ? ` · ${runtime.connections.find((c) => c.status === 'auth_failed')?.lastError ?? 'a connection was refused'}`
                          : ''}
                      </p>
                      {installedHere && hasConnections ? (
                        <Button variant="outline" size="sm" className="self-start" onClick={() => go('connections')}>
                          Manage connections
                        </Button>
                      ) : null}
                    </Part>
                  ) : null}
                  {policies.length > 0 ? (
                    <Part title="Defaults: what needs review" id="module-defaults">
                      <ModulePolicies flat policies={policies} />
                    </Part>
                  ) : null}
                </div>
              </div>
              {/* The rail: what the module is, beside what it does. Under it, on a narrow page. */}
              <div className="min-w-0 border-t border-border pt-6 @6xl:border-t-0 @6xl:pt-0">
                <Part title="Details">
                  <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                    <dt className="text-muted-foreground">Id</dt>
                    <dd className="break-all font-mono text-xs leading-5">{entry.id}</dd>
                    {declared?.website ? (
                      <>
                        <dt className="text-muted-foreground">Website</dt>
                        <dd>
                          <a
                            href={declared.website}
                            target="_blank"
                            rel="noreferrer"
                            className="underline-offset-4 hover:underline"
                          >
                            {hostOf(declared.website)}
                          </a>
                        </dd>
                      </>
                    ) : null}
                    {declared?.engines ? (
                      <>
                        <dt className="text-muted-foreground">Works with</dt>
                        <dd>
                          Devias <span className="font-mono text-xs">{declared.engines.devias}</span>
                        </dd>
                      </>
                    ) : null}
                    {installed?.version ? (
                      <>
                        <dt className="text-muted-foreground">Installed</dt>
                        <dd>v{installed.version}</dd>
                      </>
                    ) : null}
                    {manifest ? (
                      <>
                        <dt className="text-muted-foreground">Available</dt>
                        <dd>v{manifest.version}</dd>
                      </>
                    ) : (
                      <>
                        <dt className="text-muted-foreground">Build</dt>
                        <dd>Not shipped with this build, so it can only be uninstalled.</dd>
                      </>
                    )}
                    {entry.hash ? (
                      <>
                        <dt className="text-muted-foreground">Checksum</dt>
                        <dd className="font-mono text-xs leading-5">
                          {entry.hash.slice(0, 8)}
                          {entry.installedHash && entry.installedHash !== entry.hash
                            ? ` (installed ${entry.installedHash.slice(0, 8)})`
                            : ''}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                </Part>
              </div>
              {installedHere && !entry.core ? (
                // A quiet bordered card on the page's own background; only the button is red, and a confirmation follows.
                <section
                  data-slot="module-uninstall"
                  className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border px-5 py-4 @6xl:col-start-1"
                >
                  <div className="min-w-0 max-w-xl">
                    <h3 className="text-xs font-semibold">Uninstall {entry.name}</h3>
                    <p className="text-xs text-muted-foreground">
                      Removes everything the module owns: its objects with their records, its connections and variables,
                      and the events it received. What the workspace owns stays.
                    </p>
                  </div>
                  <Button variant="destructive" disabled={busy} onClick={onUninstall}>
                    Uninstall
                  </Button>
                </section>
              ) : null}
            </div>
          </TabsContent>
          <TabsContent value="changes" className="max-w-4xl">
            {plan ? (
              <div className="flex flex-col gap-4" data-slot="module-review">
                <PlanDiffViewer plan={plan} {...(pending ? { pending } : {})} />
                {plan.hasConflicts ? (
                  <p className="text-xs text-warning">
                    Some changes conflict with entities the workspace owns. Rename or remove those first.
                  </p>
                ) : null}
                {plan.hasDestructive ? (
                  <Label className="flex items-center gap-2 text-xs font-normal text-destructive">
                    <Checkbox checked={allowDestructive} onCheckedChange={(checked) => onAllowDestructive(checked)} />I
                    understand this removes data or changes field types destructively.
                  </Label>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Checking what applying this would change…</p>
            )}
          </TabsContent>
          <TabsContent value="connections" className="max-w-4xl">
            {runtime ? <ModuleConnections item={runtime} /> : null}
          </TabsContent>
          <TabsContent value="events" className="max-w-4xl">
            {runtime ? <WebhookEvents item={runtime} /> : null}
          </TabsContent>
          <TabsContent value="workflows" className="max-w-4xl">
            {runtime ? <ModuleWorkflows item={runtime} /> : null}
          </TabsContent>
        </div>
      </div>
      {action ? (
        // Beside what is being reviewed, and with it as the list scrolls; the header carries no buttons.
        <div data-slot="module-apply" className="sticky bottom-0 z-10 border-t border-border bg-background">
          <div className="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-end gap-3 px-6 py-3 sm:px-10">
            {action.hint ? <span className="text-xs text-muted-foreground">{action.hint}</span> : null}
            <Button disabled={action.disabled} onClick={action.onClick}>
              {action.label}
            </Button>
          </div>
        </div>
      ) : null}
      <AlertDialog open={confirming && plan !== undefined} onOpenChange={setConfirming}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {status === 'not_installed' ? `Install ${entry.name}?` : `Apply changes to ${entry.name}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {plan ? `${plan.fromVersion ?? 'none'} → ${plan.toVersion}. ${planSentence(plan, pending)}` : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant={plan?.hasDestructive ? 'destructive' : 'default'}
              onClick={() => {
                setConfirming(false);
                void onApply().then((ok) => ok && go('overview'));
              }}
            >
              {status === 'not_installed' ? 'Install' : 'Apply changes'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}

export { plural };
