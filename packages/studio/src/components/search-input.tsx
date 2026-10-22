import { Button, Icon, Input } from '@devias/ui';
import { useEffect, useState } from 'react';

/** Collapsed to an icon until used; stays open while it holds a query. */
export function SearchInput({
  value,
  onChange,
  label = 'Search',
}: {
  value: string;
  onChange: (value: string) => void;
  /** What the control is called for assistive technology: "Search records", "Search documents". */
  label?: string;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) {
      return;
    }

    const timer = setTimeout(() => onChange(text), 250);

    return () => clearTimeout(timer);
  }, [text, value, onChange]);

  if (!open && !text) {
    return (
      <Button
        variant="ghost"
        size="icon-lg"
        aria-label={label}
        title="Search"
        className="text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Icon name="search" />
      </Button>
    );
  }

  return (
    <div className="relative">
      <Icon
        name="search"
        className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
      />
      <Input
        autoFocus
        value={text}
        placeholder="Search…"
        aria-label={label}
        className="h-9 w-52 pl-8 text-xs"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => !text && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('');
            setOpen(false);
          }
        }}
      />
    </div>
  );
}
