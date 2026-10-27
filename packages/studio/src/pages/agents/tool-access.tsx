import type { AiToolArea, AiToolInfo, ApprovalMode } from '@devias/core';
import {
  Badge,
  Button,
  Checkbox,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
} from '@devias/ui';
import { useId, useState } from 'react';
import { toolLabel } from '../../agent-chat/chat/tool-call-card';
import { ToolDescription } from '../../agent-chat/settings/tool-description';
import { groupTools, type ToolGroup } from './tool-groups';

/** What a tool does when the agent calls it: waits for the person's approval, or goes ahead. */
export type ToolMode = 'ask' | 'auto';

/** How a tool is run for this agent: its own mode when it has one, else the workspace's. */
export const toolMode = (tool: AiToolInfo, approvals: Record<string, ApprovalMode>): ToolMode =>
  (approvals[tool.name] ?? tool.approval) === 'approve' ? 'ask' : 'auto';

const MODES: { mode: ToolMode; label: string }[] = [
  { mode: 'ask', label: 'Ask first' },
  { mode: 'auto', label: 'Runs freely' },
];

/** Ask first or run freely, in one control. */
export function ToolAccess({
  title,
  value,
  lockedToAsk,
  onChange,
}: {
  title: string;
  value: ToolMode;
  /** A tool that always asks (the workspace locked it): "Runs freely" is not on offer. */
  lockedToAsk?: boolean;
  onChange: (mode: ToolMode) => void;
}) {
  const name = useId();

  return (
    <fieldset className="m-0 inline-flex min-w-0 shrink-0 gap-1 rounded-lg border border-border bg-card p-1 text-xs">
      <legend className="sr-only">{title}</legend>
      {MODES.map((option) => {
        const disabled = option.mode === 'auto' && lockedToAsk;

        return (
          <label
            key={option.mode}
            className={cn(
              'relative inline-flex h-6 cursor-pointer items-center rounded-xs px-2.5 font-medium whitespace-nowrap text-muted-foreground select-none hover:text-foreground',
              'has-[:checked]:bg-primary has-[:checked]:text-primary-foreground',
              'has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40',
              disabled && 'cursor-not-allowed opacity-40 hover:text-muted-foreground',
            )}
          >
            <input
              type="radio"
              name={`${name}-${title}`}
              className="sr-only"
              checked={value === option.mode}
              disabled={disabled}
              onChange={() => onChange(option.mode)}
            />
            {option.label}
          </label>
        );
      })}
    </fieldset>
  );
}

/** Every tool, or only the ones picked: two cards, one chosen. */
export function ToolScope({
  chosen,
  onChange,
  disabled = false,
}: {
  chosen: boolean;
  onChange: (chosen: boolean) => void;
  /** The tool list is not the person's to change (a module's agent). */
  disabled?: boolean;
}) {
  const name = useId();
  const options = [
    {
      chosen: false,
      icon: 'boxes',
      title: 'All tools',
      text: 'Every tool the person may use, and the ones added later.',
    },
    { chosen: true, icon: 'list-checks', title: 'Chosen tools', text: 'Only the tools you pick, for a narrower job.' },
  ] as const;

  return (
    <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
      <legend className="sr-only">Which tools the agent has</legend>
      {options.map((option) => (
        <label
          key={option.title}
          className={cn(
            'flex cursor-pointer flex-col gap-1 rounded-lg border border-border bg-card p-4 transition-colors hover:bg-muted/40',
            disabled && 'pointer-events-none opacity-60',
            'has-[:checked]:border-foreground/50 has-[:checked]:ring-1 has-[:checked]:ring-foreground/15',
            'has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40',
          )}
        >
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={chosen === option.chosen}
            disabled={disabled}
            onChange={() => onChange(option.chosen)}
          />
          <span className="flex items-center gap-2 text-xs font-medium">
            <Icon name={option.icon} className="size-4 text-muted-foreground" /> {option.title}
          </span>
          <span className="text-xs text-muted-foreground">{option.text}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Flags a tool that reaches beyond what its name suggests. It blocks nothing; it tells the person what they are adding. */
export function EscalatesBadge() {
  return (
    <Badge
      variant="outline"
      className="h-5 px-1.5 text-xs"
      title="Reaches beyond what its name suggests: workflows run with their own permissions, and keys, members, modules and agents change what everyone can do."
    >
      Escalates
    </Badge>
  );
}

/** The tool as a row: what it is, ask first or runs freely, and a way to take it away. */
export function ToolRow({
  tool,
  area,
  mode,
  own,
  onMode,
  onRemove,
}: {
  tool: AiToolInfo;
  area: string;
  mode: ToolMode;
  /** The mode is the agent's own, not the workspace's. */
  own: boolean;
  onMode: (mode: ToolMode) => void;
  /** Absent when the tool list is fixed (a module's agent): there is no way to take the tool away. */
  onRemove?: () => void;
}) {
  const { title } = toolLabel(tool.name);
  const module = tool.moduleId;

  return (
    <li className="flex items-start gap-4 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 text-xs">
          <span className="font-medium">{title}</span>
          {module ? (
            <Badge variant="outline" className="h-5 px-1.5 text-xs">
              {module}
            </Badge>
          ) : null}
          {tool.escalates ? <EscalatesBadge /> : null}
          {tool.locked ? (
            <Icon name="lock" className="size-3.5 text-muted-foreground" aria-label="Always asks first" />
          ) : null}
          <span className="text-xs text-muted-foreground">{area}</span>
        </div>
        <ToolDescription text={tool.description} className="mt-0.5" />
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {own ? (
          <span className="text-xs text-muted-foreground" title="Different from the workspace's setting">
            Own
          </span>
        ) : null}
        <ToolAccess title={title} value={mode} lockedToAsk={tool.locked} onChange={onMode} />
        {onRemove ? (
          <Button variant="ghost" size="icon-sm" aria-label={`Remove ${title}`} onClick={onRemove}>
            <Icon name="x" />
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** What the picker offers: the tools not yet chosen, by area. */
function ToolPicker({
  groups,
  onAdd,
  onClose,
}: {
  groups: ToolGroup[];
  onAdd: (tools: AiToolInfo[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [area, setArea] = useState<AiToolArea | 'all'>('all');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  const needle = query.trim().toLowerCase();
  const found = (tool: AiToolInfo) =>
    !needle || `${toolLabel(tool.name).title} ${tool.name} ${tool.description}`.toLowerCase().includes(needle);
  // What the search leaves of each area; the rail counts these, the list shows the chosen area's.
  const matching = groups
    .map((group) => ({ ...group, tools: group.tools.filter(found) }))
    .filter((group) => group.tools.length > 0);
  const total = matching.reduce((sum, group) => sum + group.tools.length, 0);
  const shown = matching.filter((group) => area === 'all' || group.key === area);

  const toggle = (tool: AiToolInfo, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);

      if (on) {
        next.add(tool.name);
      } else {
        next.delete(tool.name);
      }

      return next;
    });
  const toggleArea = (tools: AiToolInfo[], on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);

      for (const tool of tools) {
        if (on) {
          next.add(tool.name);
        } else {
          next.delete(tool.name);
        }
      }

      return next;
    });
  const readOnlyTools = groups.flatMap((group) => group.tools).filter((tool) => tool.readOnly);
  const allReadOnly = readOnlyTools.length > 0 && readOnlyTools.every((tool) => picked.has(tool.name));
  const add = () => onAdd(groups.flatMap((group) => group.tools).filter((tool) => picked.has(tool.name)));

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(46rem,88vh)] flex-col gap-0 p-0 sm:max-w-4xl" data-slot="tool-picker">
        <DialogHeader className="gap-1 px-6 pt-6 pb-4">
          <DialogTitle className="text-xl leading-tight font-semibold">Add tools</DialogTitle>
          <DialogDescription>
            Pick the tools this agent may use. You can set how each one runs afterwards.
          </DialogDescription>
        </DialogHeader>
        <div className="relative px-6 pb-4">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-9 size-4 -translate-y-[calc(50%+0.5rem)] text-muted-foreground"
          />
          <Input
            value={query}
            placeholder="Search tools…"
            aria-label="Search tools"
            autoFocus
            className="h-10 pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="grid min-h-0 flex-1 border-t border-border sm:grid-cols-[13.5rem_1fr]">
          <nav
            aria-label="Areas"
            className="flex gap-1 overflow-x-auto border-b border-border p-3 sm:flex-col sm:overflow-y-auto sm:border-r sm:border-b-0"
          >
            {[
              { key: 'all' as const, label: 'All tools', count: total },
              ...matching.map((g) => ({ key: g.key, label: g.label, count: g.tools.length })),
            ].map((item) => (
              <button
                key={item.key}
                type="button"
                aria-pressed={area === item.key}
                className={cn(
                  'flex shrink-0 items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
                  area === item.key
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                )}
                onClick={() => setArea(item.key)}
              >
                {item.label}
                <span className="text-xs tabular-nums">{item.count}</span>
              </button>
            ))}
          </nav>
          <div className="min-h-0 overflow-y-auto p-3">
            {shown.length === 0 ? (
              <p className="px-3 py-10 text-center text-xs text-muted-foreground">No tool matches.</p>
            ) : (
              shown.map((group) => {
                const all = group.tools.every((tool) => picked.has(tool.name));

                return (
                  <section key={group.key} aria-label={group.label} className="mb-4 last:mb-0">
                    <header className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                        {group.label}
                      </h3>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-label={`${all ? 'Clear' : 'Select all'} in ${group.label.toLowerCase()}`}
                        onClick={() => toggleArea(group.tools, !all)}
                      >
                        {all ? 'Clear' : 'Select all'}
                      </Button>
                    </header>
                    <ul>
                      {group.tools.map((tool) => {
                        const { title } = toolLabel(tool.name);
                        const module = tool.moduleId;

                        return (
                          <li key={tool.name}>
                            {/* The whole row picks the tool; the checkbox in it is the control for the keyboard. */}
                            {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the checkbox inside takes the keys */}
                            <div
                              className={cn(
                                'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/50',
                                picked.has(tool.name) && 'bg-muted/60',
                              )}
                              onClick={() => toggle(tool, !picked.has(tool.name))}
                            >
                              <Checkbox
                                className="mt-0.5"
                                aria-label={title}
                                checked={picked.has(tool.name)}
                                onClick={(event) => event.stopPropagation()}
                                onCheckedChange={(checked) => toggle(tool, checked)}
                              />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 text-xs">
                                  <span className="font-medium">{title}</span>
                                  {module ? (
                                    <Badge variant="outline" className="h-5 px-1.5 text-xs">
                                      {module}
                                    </Badge>
                                  ) : null}
                                  {tool.escalates ? <EscalatesBadge /> : null}
                                  {tool.locked ? (
                                    <Icon
                                      name="lock"
                                      className="size-3.5 text-muted-foreground"
                                      aria-label="Always asks first"
                                    />
                                  ) : null}
                                </div>
                                <ToolDescription text={tool.description} className="mt-0.5" />
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })
            )}
          </div>
        </div>
        <DialogFooter className="m-0 items-center px-6 py-4 sm:justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            {picked.size === 0 ? 'Nothing selected' : `${picked.size} selected`}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              disabled={readOnlyTools.length === 0}
              onClick={() => toggleArea(readOnlyTools, !allReadOnly)}
            >
              {allReadOnly ? 'Clear read-only tools' : 'Select read-only tools'}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={add} disabled={picked.size === 0}>
              {picked.size === 1 ? 'Add 1 tool' : `Add ${picked.size || ''} tools`.replace('  ', ' ')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens the picker of the tools not yet chosen. Adding closes it. */
export function AddTools({
  groups,
  onAdd,
}: {
  /** The tools left to add, by area. */
  groups: ToolGroup[];
  onAdd: (tools: AiToolInfo[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const left = groups.reduce((sum, group) => sum + group.tools.length, 0);

  return (
    <>
      <Button variant="outline" size="lg" disabled={left === 0} onClick={() => setOpen(true)}>
        <Icon name="plus" /> Add tools
      </Button>
      {open ? (
        <ToolPicker
          groups={groups}
          onClose={() => setOpen(false)}
          onAdd={(tools) => {
            onAdd(tools);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/** The tools by area, flat, each with the name of its area: the order the chosen tools are listed in. */
export const inAreas = (tools: AiToolInfo[]): { tool: AiToolInfo; area: string }[] =>
  groupTools(tools).flatMap((group) => group.tools.map((tool) => ({ tool, area: group.label })));
