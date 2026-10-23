import type { AiAgent, AiAgentInput, AiSkillSummary, AiToolInfo, ApprovalMode } from '@devias/core';
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
  cn,
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  Page,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AgentMark } from '../../agent-chat/agent-mark';
import { toolLabel } from '../../agent-chat/chat/tool-call-card';
import { defaultAgentOf, useAiSettings, useAllAgents } from '../../hooks/use-agents';
import { errorMessage } from '../../hooks/use-mutations';
import { useAllSkills } from '../../hooks/use-skills';
import { useClient } from '../../providers/client';
import { useSchema } from '../../providers/schema';
import { useStudioConfig } from '../../providers/studio-config';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { AgentUsageCard } from './agent-usage';
import { AddSkills, ChosenSkills, SkillScope } from './skill-access';
import { StarterPrompts } from './starter-prompts';
import { templateOf } from './templates';
import { AddTools, inAreas, ToolAccess, type ToolMode, ToolRow, ToolScope, toolMode } from './tool-access';
import { groupTools } from './tool-groups';

/** What the editor holds; saved as one create or update. */
interface Draft {
  name: string;
  icon: string;
  description: string;
  instructions: string;
  starterPrompts: string[];
  /** Tasks can be given to it. */
  takesTasks: boolean;
  /** The agent Home and new conversations use (saved to the workspace's settings, not to the agent). */
  isDefault: boolean;
  /** Off: every tool the person may use. On: only `tools`. */
  limitTools: boolean;
  tools: Set<string>;
  /** Off: every active skill. On: only `skills`. */
  limitSkills: boolean;
  skills: Set<string>;
  /** The agent's own modes, where they differ from the workspace's. */
  approvals: Record<string, ApprovalMode>;
}

/** What a draft starts from: an agent, or a template's input. */
type DraftSource = Partial<
  Pick<AiAgent, 'name' | 'icon' | 'description' | 'instructions' | 'tools' | 'skills' | 'starterPrompts' | 'takesTasks'>
> & {
  approvalOverrides?: Record<string, ApprovalMode> | undefined;
};

const draftOf = (source: DraftSource | null, isDefault = false): Draft => ({
  name: source?.name ?? '',
  icon: source?.icon ?? '',
  description: source?.description ?? '',
  instructions: source?.instructions ?? '',
  starterPrompts: [...(source?.starterPrompts ?? [])],
  isDefault,
  takesTasks: source?.takesTasks ?? false,
  limitTools: source?.tools !== null && source?.tools !== undefined,
  tools: new Set(source?.tools ?? []),
  limitSkills: source?.skills !== null && source?.skills !== undefined,
  skills: new Set(source?.skills ?? []),
  approvals: { ...(source?.approvalOverrides ?? {}) },
});

const cleanPrompts = (prompts: string[]): string[] => [...new Set(prompts.map((p) => p.trim()).filter(Boolean))];

const inputOf = (draft: Draft, active?: ReadonlySet<string>): AiAgentInput => ({
  name: draft.name.trim(),
  icon: draft.icon.trim() || null,
  description: draft.description.trim() || null,
  instructions: draft.instructions.trim() || null,
  starterPrompts: cleanPrompts(draft.starterPrompts),
  tools: draft.limitTools ? [...draft.tools] : null,
  // A skill archived since it was picked is left out, once the skills are known.
  skills: draft.limitSkills ? [...draft.skills].filter((id) => !active || active.has(id)) : null,
  approvalOverrides: draft.approvals,
  takesTasks: draft.takesTasks,
});

/** What would be saved, in an order that does not depend on how it was ticked, to tell whether anything changed. */
const fingerprint = (draft: Draft): string => {
  const input = inputOf(draft);

  return JSON.stringify({
    ...input,
    isDefault: draft.isDefault,
    tools: input.tools ? [...input.tools].sort() : null,
    skills: input.skills ? [...input.skills].sort() : null,
    approvalOverrides: Object.fromEntries(Object.entries(input.approvalOverrides ?? {}).sort()),
  });
};

/** Icons to pick from at a glance when the app maps no images for agents; the field takes any icon name. */
const ICON_CHOICES = [
  'bot',
  'agent',
  'briefcase',
  'book-open',
  'chart-bar',
  'mail',
  'receipt',
  'users',
  'wallet',
  'wrench',
  'shield',
  'package',
  'truck',
  'calendar',
] as const;

const TABS = [
  { key: 'general', title: 'General' },
  { key: 'instructions', title: 'Instructions' },
  { key: 'tools', title: 'Tools' },
  { key: 'skills', title: 'Skills' },
  // Only an agent that exists has been used.
  { key: 'usage', title: 'Usage' },
] as const;

/**
 * An agent's page: who it is, what it is told and suggests, and which tools it has, in tabs, saved together from the
 * header. Null `agent` is a new one, which may start from a template (`?template=`).
 */
export function AgentEditorPage({ agent, tools }: { agent: AiAgent | null; tools: AiToolInfo[] }) {
  const client = useClient();
  const { workspaceId, slug } = useWorkspace();
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const { index } = useSchema();
  const modules = index.schema.modules;
  const allAgents = useAllAgents();
  const settings = useAiSettings();
  const defaultId = defaultAgentOf(allAgents.data ?? [], settings.data)?.id;
  const template = agent ? undefined : templateOf(navigation.search.template);
  // The saved state the draft is compared with: the agent, or a new agent's template.
  const initial = useMemo(
    () => draftOf(agent ?? template?.build(tools) ?? null, agent ? agent.id === defaultId : false),
    [agent, template, tools, defaultId],
  );
  const [draft, setDraft] = useState<Draft>(initial);
  // The icons to pick from: the app's images for agents when it has any, else a few line icons.
  const { agentImages } = useStudioConfig();
  const images = Object.keys(agentImages);
  const iconChoices = images.length > 0 ? images : [...ICON_CHOICES];
  const [busy, setBusy] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const archived = agent?.archivedAt != null;
  // A module's agent: what it is, says and can do is the module's, so only approvals, the default and archiving are ours.
  const owner = agent?.moduleId
    ? { id: agent.moduleId, name: modules.find((m) => m.moduleId === agent.moduleId)?.name ?? agent.moduleId }
    : null;
  // The tools this agent has when it has chosen them, and the ones it could still be given.
  const chosen = useMemo(() => tools.filter((tool) => draft.tools.has(tool.name)), [tools, draft.tools]);
  const toolsLeft = useMemo(
    () => groupTools(tools.filter((tool) => !draft.tools.has(tool.name))),
    [tools, draft.tools],
  );
  const overrides = tools.filter((tool) => draft.approvals[tool.name] !== undefined);
  // The skills it could be given (the active ones), and which of the picked ones still are.
  const skillList = useAllSkills();
  const activeSkills = useMemo(
    () => (skillList.data ?? []).filter((skill) => skill.archivedAt === null),
    [skillList.data],
  );
  const activeIds = useMemo(
    () => (skillList.data ? new Set(activeSkills.map((skill) => skill.id)) : undefined),
    [skillList.data, activeSkills],
  );
  const chosenSkills = activeSkills.filter((skill) => draft.skills.has(skill.id));
  const pickedSkills = chosenSkills.length;
  const skillsLeft = activeSkills.filter((skill) => !draft.skills.has(skill.id));
  const skillSources = useMemo(() => new Map(modules.map((m) => [m.moduleId, m.name])), [modules]);
  const addSkills = (added: AiSkillSummary[]) =>
    setDraft((d) => ({ ...d, skills: new Set([...d.skills, ...added.map((skill) => skill.id)]) }));
  const removeSkill = (skill: AiSkillSummary) =>
    setDraft((d) => {
      const kept = new Set(d.skills);
      kept.delete(skill.id);

      return { ...d, skills: kept };
    });

  const listHref = links.agents(slug);
  const named = draft.name.trim().length > 0;
  const noTools = draft.limitTools && chosen.length === 0;
  const valid = named && !noTools;
  const dirty = !agent || fingerprint(draft) !== fingerprint(initial);

  const addTools = (added: AiToolInfo[]) =>
    setDraft((d) => ({ ...d, tools: new Set([...d.tools, ...added.map((tool) => tool.name)]) }));
  const removeTool = (tool: AiToolInfo) =>
    setDraft((d) => {
      const kept = new Set(d.tools);
      kept.delete(tool.name);
      const approvals = { ...d.approvals };
      delete approvals[tool.name];

      return { ...d, tools: kept, approvals };
    });
  /** Only a mode that differs from the workspace's is the agent's own. */
  const setMode = (tool: AiToolInfo, mode: ToolMode) =>
    setDraft((d) => {
      const approvals = { ...d.approvals };
      const next: ApprovalMode = mode === 'ask' ? 'approve' : 'auto';

      if (next === tool.approval) {
        delete approvals[tool.name];
      } else {
        approvals[tool.name] = next;
      }

      return { ...d, approvals };
    });
  const resetMode = (tool: AiToolInfo) =>
    setDraft((d) => {
      const approvals = { ...d.approvals };
      delete approvals[tool.name];

      return { ...d, approvals };
    });
  const tabParam = String(navigation.search.tab ?? '');
  const tabs = agent ? TABS : TABS.filter((t) => t.key !== 'usage');
  const tab = tabs.find((t) => t.key === tabParam)?.key ?? 'general';
  const title = draft.name.trim() || 'New agent';

  const save = async () => {
    setBusy(true);

    try {
      // The module owns the rest of its agent, so only the approvals are sent.
      const input = owner
        ? { approvalOverrides: draft.approvals, takesTasks: draft.takesTasks }
        : inputOf(draft, activeIds);
      const saved = agent
        ? await client.ai.agents.update(agent.id, input)
        : await client.ai.agents.create(input as AiAgentInput);

      // The default is the workspace's setting: turning it on points it here, turning it off lets the fallback decide.
      if (draft.isDefault !== initial.isDefault) {
        await client.ai.settings.update({ defaultAgentId: draft.isDefault ? saved.id : null });
      }

      toast.success(agent ? 'Agent updated' : 'Agent created');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.aiAgents(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: keys.aiSettings(workspaceId) }),
      ]);

      if (!agent) {
        navigation.navigate(links.agent(slug, saved.id), { replace: true });
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  /** Archiving keeps the agent and its conversations; restoring puts it back among the agents people can pick. */
  const setArchived = async (next: boolean) => {
    if (!agent) {
      return;
    }

    setBusy(true);

    try {
      await client.ai.agents.update(agent.id, { archived: next });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.aiAgents(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: keys.aiSettings(workspaceId) }),
      ]);
      toast.success(next ? `${agent.name} archived` : `${agent.name} restored`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const leave = () => (dirty && agent ? setLeaving(true) : navigation.navigate(listHref));

  return (
    <Page fullBleed className="bg-background">
      <Tabs
        className="flex-1 gap-0"
        value={tab}
        onValueChange={(value) => navigation.navigate(links.agent(slug, agent?.id, String(value)), { replace: true })}
      >
        {/* The header and the tabs share the column of the page below them; the line the tabs sit on runs across. */}
        <div className="border-b border-border" data-slot="agent-header">
          <div className="mx-auto w-full max-w-6xl px-8 pt-5">
            <Breadcrumbs
              items={[{ label: 'Agents', href: listHref }, { label: title }]}
              linkComponent={navigation.Link}
              className="-ml-1"
            />
            <div className="mt-5 flex items-start justify-between gap-6">
              <div className="flex min-w-0 items-center gap-4">
                <AgentMark tile icon={draft.icon} className="size-14" />
                <div className="min-w-0">
                  <h1 className="truncate font-heading text-heading">{title}</h1>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {draft.description.trim() || 'An agent with its own instructions, tools and approvals.'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="lg" onClick={leave} disabled={busy}>
                  Cancel
                </Button>
                <Button
                  size="lg"
                  onClick={() => void save()}
                  disabled={busy || !valid || !dirty}
                  title={!named ? 'Give the agent a name' : noTools ? 'Add at least one tool' : undefined}
                >
                  {agent ? 'Save' : 'Create agent'}
                </Button>
              </div>
            </div>
            <TabsList variant="underline" className="mt-6">
              {tabs.map((t) => (
                <TabsTrigger key={t.key} value={t.key}>
                  {t.title}
                  {t.key === 'skills' && draft.limitSkills ? (
                    <span className="text-xs tabular-nums text-muted-foreground">{pickedSkills}</span>
                  ) : null}
                  {t.key === 'tools' && draft.limitTools ? (
                    <span
                      className={cn('text-xs tabular-nums', noTools ? 'text-destructive' : 'text-muted-foreground')}
                    >
                      {chosen.length}
                    </span>
                  ) : null}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>
        <div className="mx-auto w-full max-w-6xl flex-1 px-8 pt-8 pb-12">
          <div className="max-w-3xl">
            {owner && tab !== 'usage' ? (
              <p
                data-slot="module-owned"
                className="mb-6 flex items-start gap-2 rounded-lg bg-muted/60 px-4 py-3 text-xs text-muted-foreground"
              >
                <Icon name="puzzle" className="mt-0.5 size-4 shrink-0" />
                <span>
                  {agent?.archivedAt && !modules.some((m) => m.moduleId === owner.id)
                    ? `The module ${owner.name} is not installed, so this agent is archived until it is.`
                    : `Comes with the module ${owner.name}. Its name, instructions and tools change when the module updates. You can set how its tools ask for approval, make it the default, or archive it.`}
                </span>
              </p>
            ) : null}
            <TabsContent value="general">
              <fieldset disabled={owner !== null} className="m-0 min-w-0 border-0 p-0">
                <FieldGroup className="gap-6">
                  <Field>
                    <FieldLabel htmlFor="agent-name">Name</FieldLabel>
                    <Input
                      id="agent-name"
                      value={draft.name}
                      placeholder="Sales agent"
                      autoFocus={!agent}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="agent-description">What it is for</FieldLabel>
                    <Input
                      id="agent-description"
                      value={draft.description}
                      placeholder="Keeps the pipeline tidy and drafts follow-ups"
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    />
                    <FieldDescription>Shown where people pick an agent.</FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="agent-icon">Icon</FieldLabel>
                    <div className="flex items-center gap-2">
                      <AgentMark icon={draft.icon} className="size-8" />
                      <Input
                        id="agent-icon"
                        value={draft.icon}
                        placeholder={iconChoices[0] ?? 'bot'}
                        className="max-w-48"
                        onChange={(event) => setDraft({ ...draft, icon: event.target.value })}
                      />
                    </div>
                    {owner ? null : (
                      <fieldset className="m-0 flex min-w-0 flex-wrap gap-3 border-0 p-1 pt-2">
                        <legend className="sr-only">Icons</legend>
                        {iconChoices.map((name) => (
                          // The mark is the choice: no button box around it, the chosen one gets a ring that follows its own corners.
                          <button
                            key={name}
                            type="button"
                            className={cn(
                              'size-9 shrink-0 cursor-pointer rounded-full outline-none transition-[box-shadow,opacity] hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
                              draft.icon.trim() === name &&
                                'ring-2 ring-foreground ring-offset-2 ring-offset-background hover:opacity-100',
                            )}
                            aria-label={`Use the ${name} icon`}
                            aria-pressed={draft.icon.trim() === name}
                            onClick={() => setDraft({ ...draft, icon: name })}
                          >
                            <AgentMark icon={name} className="size-9" />
                          </button>
                        ))}
                      </fieldset>
                    )}
                    {owner ? null : <FieldDescription>Pick one, or type any icon name.</FieldDescription>}
                  </Field>
                </FieldGroup>
              </fieldset>
              <Field orientation="horizontal" className="mt-6 items-start justify-between gap-6">
                <div className="min-w-0">
                  <FieldLabel htmlFor="agent-takes-tasks">Takes tasks</FieldLabel>
                  <FieldDescription>
                    Tasks can be given to it. It works each one on its own, for the person who gave it, and everything
                    it proposes that changes data waits for that person’s approval before the task goes to review.
                  </FieldDescription>
                </div>
                <Switch
                  id="agent-takes-tasks"
                  checked={draft.takesTasks}
                  disabled={archived}
                  onCheckedChange={(takesTasks) => setDraft({ ...draft, takesTasks })}
                />
              </Field>
              <Field orientation="horizontal" className="mt-6 items-start justify-between gap-6">
                <div className="min-w-0">
                  <FieldLabel htmlFor="agent-default">Default agent</FieldLabel>
                  <FieldDescription>
                    Home and new conversations start with it. When none is the default, the first agent by name is.
                  </FieldDescription>
                </div>
                <Switch
                  id="agent-default"
                  checked={draft.isDefault}
                  disabled={archived}
                  onCheckedChange={(isDefault) => setDraft({ ...draft, isDefault })}
                />
              </Field>
              {agent ? (
                // A quiet bordered card on the page's own background. Archiving is undone from here too.
                <section
                  data-slot="agent-archive"
                  className="mt-10 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border px-5 py-4"
                >
                  <div className="min-w-0 max-w-xl">
                    <h3 className="text-xs font-semibold">
                      {archived ? `${agent.name} is archived` : `Archive ${agent.name}`}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      {archived
                        ? 'It takes no new messages. Restore it to let people talk to it again.'
                        : 'It takes no new messages and leaves the pickers. Its conversations stay readable, and you can restore it any time.'}
                    </p>
                  </div>
                  <Button variant="outline" disabled={busy} onClick={() => void setArchived(!archived)}>
                    <Icon name={archived ? 'rotate-ccw' : 'archive'} /> {archived ? 'Restore' : 'Archive'}
                  </Button>
                </section>
              ) : null}
            </TabsContent>
            <TabsContent value="instructions">
              <fieldset disabled={owner !== null} className="m-0 min-w-0 border-0 p-0">
                <Field>
                  <FieldLabel htmlFor="agent-instructions">Instructions</FieldLabel>
                  <Textarea
                    id="agent-instructions"
                    value={draft.instructions}
                    rows={16}
                    className="min-h-64 resize-y"
                    placeholder="Focus on deals and tasks. Always confirm amounts before changing them. Write in a friendly, brief tone."
                    onChange={(event) => setDraft({ ...draft, instructions: event.target.value })}
                  />
                  <FieldDescription>Added to the prompt of every conversation with this agent.</FieldDescription>
                </Field>
                <Field className="mt-8">
                  <FieldLabel>Starter prompts</FieldLabel>
                  <FieldDescription>
                    What Home and an empty conversation suggest for this agent, each finishing "I want to …".
                  </FieldDescription>
                  <StarterPrompts
                    value={draft.starterPrompts}
                    onChange={(starterPrompts) => setDraft({ ...draft, starterPrompts })}
                  />
                </Field>
              </fieldset>
            </TabsContent>
            <TabsContent value="tools">
              <div className="mb-5">
                <h2 className="font-heading text-h4">Tools</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  What this agent can do, where the person may use it. Ask first waits for their approval before it
                  runs.
                </p>
              </div>
              <ToolScope
                chosen={draft.limitTools}
                disabled={owner !== null}
                onChange={(limitTools) => setDraft({ ...draft, limitTools })}
              />
              <div className="mt-8">
                {draft.limitTools ? (
                  <>
                    <div className="mb-3 flex min-h-9 items-center justify-between gap-2">
                      <h3 className="font-heading text-h4">
                        {chosen.length === 1 ? '1 tool' : `${chosen.length} tools`}
                      </h3>
                      {owner ? null : <AddTools groups={toolsLeft} onAdd={addTools} />}
                    </div>
                    {chosen.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
                        <p className="text-xs font-medium">No tools yet</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Add the tools this agent may use. It can do nothing else.
                        </p>
                      </div>
                    ) : (
                      <ul
                        className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-card-border"
                        data-slot="chosen-tools"
                      >
                        {inAreas(chosen).map(({ tool, area }) => (
                          <ToolRow
                            key={tool.name}
                            tool={tool}
                            area={area}
                            mode={toolMode(tool, draft.approvals)}
                            own={draft.approvals[tool.name] !== undefined}
                            onMode={(mode) => setMode(tool, mode)}
                            {...(owner ? {} : { onRemove: () => removeTool(tool) })}
                          />
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <>
                    <div className="rounded-lg bg-card p-5 ring-1 ring-card-border" data-slot="all-tools">
                      <p className="text-xs">{tools.length} tools today, and any that are added later.</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {groupTools(tools).map((group) => (
                          <span
                            key={group.key}
                            className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs"
                          >
                            {group.label}
                            <span className="text-muted-foreground tabular-nums">{group.tools.length}</span>
                          </span>
                        ))}
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">
                        Each asks first or runs freely as the workspace says. To set that tool by tool, or to give this
                        agent a narrower job, choose its tools.
                      </p>
                    </div>
                    {overrides.length > 0 ? (
                      <section className="mt-8">
                        <h3 className="mb-3 font-heading text-h4">Its own approvals</h3>
                        <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-card-border">
                          {overrides.map((tool) => (
                            <li key={tool.name} className="flex items-center justify-between gap-4 px-4 py-3">
                              <span className="text-xs font-medium">{toolLabel(tool.name).title}</span>
                              <div className="flex items-center gap-2">
                                <ToolAccess
                                  title={toolLabel(tool.name).title}
                                  value={toolMode(tool, draft.approvals)}
                                  lockedToAsk={tool.locked}
                                  onChange={(mode) => setMode(tool, mode)}
                                />
                                <Button variant="ghost" size="sm" onClick={() => resetMode(tool)}>
                                  Use the workspace's
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                  </>
                )}
              </div>
            </TabsContent>
            <TabsContent value="skills">
              <div className="mb-5">
                <h2 className="font-heading text-h4">Skills</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Procedures the workspace wrote. This agent sees the title of each and when to use it, and loads one
                  when a request calls for it. A skill gives it no tool it does not already have.
                </p>
              </div>
              <SkillScope
                chosen={draft.limitSkills}
                disabled={owner !== null}
                onChange={(limitSkills) => setDraft({ ...draft, limitSkills })}
              />
              <div className="mt-8">
                {draft.limitSkills ? (
                  <>
                    <div className="mb-3 flex min-h-9 items-center justify-between gap-2">
                      <h3 className="font-heading text-h4">
                        {chosenSkills.length === 1 ? '1 skill' : `${chosenSkills.length} skills`}
                      </h3>
                      {owner ? null : <AddSkills skills={skillsLeft} sources={skillSources} onAdd={addSkills} />}
                    </div>
                    {chosenSkills.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-border px-6 py-10 text-center">
                        <p className="text-xs font-medium">No skills yet</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {owner ? (
                            'This agent uses none.'
                          ) : (
                            <>
                              Add the skills this agent may use, or{' '}
                              <navigation.Link href={links.skill(slug)} className="underline underline-offset-2">
                                write a new one
                              </navigation.Link>
                              .
                            </>
                          )}
                        </p>
                      </div>
                    ) : (
                      <ChosenSkills
                        skills={chosenSkills}
                        sources={skillSources}
                        {...(owner ? {} : { onRemove: removeSkill })}
                      />
                    )}
                  </>
                ) : (
                  <div className="rounded-lg bg-card p-5 ring-1 ring-card-border" data-slot="all-skills">
                    <p className="text-xs">
                      {activeSkills.length === 1 ? '1 skill' : `${activeSkills.length} skills`} today, and any written
                      later.
                    </p>
                  </div>
                )}
              </div>
            </TabsContent>
            {agent ? (
              <TabsContent value="usage">
                <div className="mb-5">
                  <h2 className="font-heading text-h4">Usage</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The tokens conversations with this agent used, from everyone in the workspace, archived
                    conversations included.
                  </p>
                </div>
                <AgentUsageCard agentId={agent.id} />
              </TabsContent>
            ) : null}
          </div>
        </div>
      </Tabs>
      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Discard your changes?</AlertDialogTitle>
            <AlertDialogDescription>What you changed on this agent has not been saved.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => navigation.navigate(listHref)}>
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
