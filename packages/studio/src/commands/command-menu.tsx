import type { CommandDefinition } from '@devias/core';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
  Icon,
} from '@devias/ui';
import { useEffect, useMemo, useState } from 'react';
import { useCommands } from '../providers/commands';
import { formatShortcut } from './keybindings';

const matches = (command: CommandDefinition, query: string): boolean => {
  if (!query) {
    return true;
  }

  const haystack = [command.label, command.group ?? '', ...(command.keywords ?? [])].join(' ').toLowerCase();

  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => haystack.includes(word));
};

/** The Cmd+K palette: static commands, provider results (navigation, record search, create) and shortcuts. */
export function CommandMenu() {
  const { open, setOpen, commands, providers, context, run } = useCommands();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CommandDefinition[]>([]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      const lists = await Promise.all(
        providers.map(async (provider) => {
          try {
            return await provider.search(query, context);
          } catch {
            return [];
          }
        }),
      );

      if (!cancelled) {
        setResults(lists.flat());
      }
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, providers, context, open]);

  const groups = useMemo(() => {
    const seen = new Set<string>();
    const grouped = new Map<string, CommandDefinition[]>();

    for (const command of [...commands.filter((c) => matches(c, query)), ...results]) {
      if (seen.has(command.id)) {
        continue;
      }

      seen.add(command.id);
      const group = command.group ?? 'Commands';
      const list = grouped.get(group) ?? [];
      list.push(command);
      grouped.set(group, list);
    }

    return [...grouped.entries()];
  }, [commands, results, query]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Command menu" description="Search commands and records">
      <Command shouldFilter={false}>
        <CommandInput placeholder="Type a command or search records…" value={query} onValueChange={setQuery} />
        <CommandList>
          <CommandEmpty>No results.</CommandEmpty>
          {groups.map(([group, items]) => (
            <CommandGroup key={group} heading={group}>
              {items.map((command) => (
                <CommandItem key={command.id} value={command.id} onSelect={() => void run(command)}>
                  <Icon name={command.icon ?? 'command'} className="text-muted-foreground" />
                  <span className="truncate">{command.label}</span>
                  {command.shortcut ? <CommandShortcut>{formatShortcut(command.shortcut)}</CommandShortcut> : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
