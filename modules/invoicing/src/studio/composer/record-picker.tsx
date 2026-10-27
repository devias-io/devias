import type { RecordData } from '@devias/core';
import { useRecords } from '@devias/studio';
import { Button, Icon, Input } from '@devias/ui';
import { useEffect, useMemo, useState } from 'react';
import { text } from '../shared';
import type { ComposerParty } from './composer-state';

/** What a company or person is called in a list. */
export const partyLabel = (object: 'company' | 'person', record: RecordData): string =>
  object === 'company'
    ? (text(record.name) ?? record.id)
    : [text(record.first_name), text(record.last_name)].filter(Boolean).join(' ') || (text(record.email) ?? record.id);

/**
 * Pick one company or person: search as you type, with suggestions shown first. A chosen record becomes a small
 * card with a way to change it.
 */
export function RecordPicker({
  object,
  value,
  onChange,
  placeholder,
  suggestions = [],
  suggestionsTitle = 'Suggestions',
}: {
  object: 'company' | 'person';
  value: ComposerParty | null;
  onChange: (party: ComposerParty | null) => void;
  placeholder: string;
  suggestions?: ComposerParty[];
  suggestionsTitle?: string;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 150);

    return () => clearTimeout(timer);
  }, [query]);
  const results = useRecords(
    useMemo(() => ({ object, limit: 6, ...(debounced ? { search: debounced } : {}) }), [object, debounced]),
    { enabled: !value },
  );

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3">
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon name={object === 'company' ? 'building-2' : 'user'} className="size-4" />
          </span>
          <span className="truncate text-xs font-medium">{value.label}</span>
        </span>
        <Button variant="ghost" size="sm" onClick={() => onChange(null)}>
          Change
        </Button>
      </div>
    );
  }

  const found = (results.data?.items ?? []).map((record) => ({ id: record.id, label: partyLabel(object, record) }));
  const list = debounced ? found : suggestions.length > 0 ? suggestions : found;
  const title = debounced ? 'Results' : suggestions.length > 0 ? suggestionsTitle : 'Suggestions';

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Icon
          name="search"
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="h-10 pl-9"
        />
      </div>
      {list.length > 0 ? (
        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{title}</span>
          <ul className="flex flex-col rounded-lg border border-dashed border-border">
            {list.map((party) => (
              <li key={party.id} className="border-b border-dashed border-border last:border-b-0">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-xs transition-colors hover:bg-muted/40"
                  onClick={() => onChange(party)}
                >
                  <span className="truncate font-medium">{party.label}</span>
                  <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium">Select</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : debounced && !results.isPending ? (
        <p className="text-xs text-muted-foreground">Nothing matches “{debounced}”.</p>
      ) : null}
    </div>
  );
}
