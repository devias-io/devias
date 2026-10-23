import type { AiSkillSummary } from '@devias/core';
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

/** The module a skill comes with, by name; absent for a skill the workspace wrote. */
export type SkillSources = ReadonlyMap<string, string>;

const skillMatches = (skill: AiSkillSummary, needle: string): boolean =>
  !needle || `${skill.title} ${skill.description}`.toLowerCase().includes(needle);

/** What the picker offers: the skills the agent does not have yet, found by a search. */
function SkillPickerDialog({
  skills,
  sources,
  onAdd,
  onClose,
}: {
  skills: readonly AiSkillSummary[];
  sources: SkillSources;
  onAdd: (skills: AiSkillSummary[]) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const needle = query.trim().toLowerCase();
  const shown = skills.filter((skill) => skillMatches(skill, needle));

  const toggle = (id: string, on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);

      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }

      return next;
    });
  const allShown = shown.length > 0 && shown.every((skill) => picked.has(skill.id));
  const toggleShown = (on: boolean) =>
    setPicked((current) => {
      const next = new Set(current);

      for (const skill of shown) {
        if (on) {
          next.add(skill.id);
        } else {
          next.delete(skill.id);
        }
      }

      return next;
    });

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(40rem,88vh)] flex-col gap-0 p-0 sm:max-w-2xl" data-slot="skill-picker">
        <DialogHeader className="gap-1 px-6 pt-6 pb-4">
          <DialogTitle className="text-xl leading-tight font-semibold">Add skills</DialogTitle>
          <DialogDescription>Pick the skills this agent may use.</DialogDescription>
        </DialogHeader>
        <div className="relative px-6 pb-4">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-9 size-4 -translate-y-[calc(50%+0.5rem)] text-muted-foreground"
          />
          <Input
            value={query}
            placeholder="Search skills…"
            aria-label="Search skills"
            autoFocus
            className="h-10 pl-9"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto border-t border-border p-3">
          {shown.length === 0 ? (
            <p className="px-3 py-10 text-center text-xs text-muted-foreground">
              {needle ? 'No skill matches.' : 'Every skill is already added.'}
            </p>
          ) : (
            <ul>
              {shown.map((skill) => {
                const source = skill.moduleId ? (sources.get(skill.moduleId) ?? skill.moduleId) : null;

                return (
                  <li key={skill.id}>
                    {/* The whole row picks the skill; the checkbox in it is the control for the keyboard. */}
                    {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: the checkbox inside takes the keys */}
                    <div
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg px-3 py-3 transition-colors hover:bg-muted/50',
                        picked.has(skill.id) && 'bg-muted/60',
                      )}
                      onClick={() => toggle(skill.id, !picked.has(skill.id))}
                    >
                      <Checkbox
                        className="mt-0.5"
                        aria-label={skill.title}
                        checked={picked.has(skill.id)}
                        onClick={(event) => event.stopPropagation()}
                        onCheckedChange={(checked) => toggle(skill.id, checked)}
                      />
                      <div className="min-w-0 flex-1 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{skill.title}</span>
                          {source ? (
                            <Badge variant="outline" className="h-5 px-1.5 text-xs">
                              {source}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-0.5 text-muted-foreground">{skill.description}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <DialogFooter className="m-0 items-center px-6 py-4 sm:justify-between">
          <span className="text-xs text-muted-foreground tabular-nums">
            {picked.size === 0 ? 'Nothing selected' : `${picked.size} selected`}
          </span>
          <div className="flex gap-2">
            <Button variant="ghost" disabled={shown.length === 0} onClick={() => toggleShown(!allShown)}>
              {allShown ? 'Clear' : needle ? 'Select the matches' : 'Select all'}
            </Button>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => onAdd(skills.filter((skill) => picked.has(skill.id)))} disabled={picked.size === 0}>
              {picked.size === 1 ? 'Add 1 skill' : `Add ${picked.size || ''} skills`.replace('  ', ' ')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** A button that opens the picker of the skills the agent does not have yet. Adding closes it. */
export function AddSkills({
  skills,
  sources,
  onAdd,
  children = 'Add skills',
}: {
  /** The skills left to add. */
  skills: readonly AiSkillSummary[];
  sources: SkillSources;
  onAdd: (skills: AiSkillSummary[]) => void;
  children?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="outline" size="lg" disabled={skills.length === 0} onClick={() => setOpen(true)}>
        <Icon name="plus" /> {children}
      </Button>
      {open ? (
        <SkillPickerDialog
          skills={skills}
          sources={sources}
          onClose={() => setOpen(false)}
          onAdd={(added) => {
            onAdd(added);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

/** The skills an agent has, each with when it is for and a way to take it away. */
export function ChosenSkills({
  skills,
  sources,
  onRemove,
}: {
  skills: readonly AiSkillSummary[];
  sources: SkillSources;
  /** Absent when the list is not the person's to change (a module's agent). */
  onRemove?: (skill: AiSkillSummary) => void;
}) {
  return (
    <ul
      className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-card-border"
      data-slot="chosen-skills"
    >
      {skills.map((skill) => {
        const source = skill.moduleId ? (sources.get(skill.moduleId) ?? skill.moduleId) : null;

        return (
          <li key={skill.id} className="flex items-start gap-3 px-4 py-3">
            <div className="min-w-0 flex-1 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-medium">{skill.title}</span>
                {source ? (
                  <Badge variant="outline" className="h-5 px-1.5 text-xs">
                    {source}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-0.5 text-muted-foreground">{skill.description}</p>
            </div>
            {onRemove ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${skill.title}`}
                onClick={() => onRemove(skill)}
              >
                <Icon name="x" />
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Every skill, or only the ones chosen: two cards, one picked, as for tools. */
export function SkillScope({
  chosen,
  onChange,
  disabled = false,
}: {
  chosen: boolean;
  onChange: (chosen: boolean) => void;
  /** The skill list is not the person's to change (a module's agent). */
  disabled?: boolean;
}) {
  const name = useId();
  const options = [
    {
      chosen: false,
      icon: 'boxes',
      title: 'All skills',
      text: 'Every skill the workspace has, and the ones written later.',
    },
    {
      chosen: true,
      icon: 'list-checks',
      title: 'Chosen skills',
      text: 'Only the skills you pick, for a narrower job.',
    },
  ] as const;

  return (
    <fieldset className="m-0 grid min-w-0 gap-3 border-0 p-0 sm:grid-cols-2">
      <legend className="sr-only">Which skills the agent may use</legend>
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
