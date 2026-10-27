import { cn } from '@devias/ui';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { UNTITLED_RECORD_LABEL } from '../views/view-state';

/** A heading-sized title that grows with its text; Enter or the down arrow at its end continues into the body. */
export function TitleField({
  value,
  readOnly,
  className,
  selectOnMount,
  onChange,
  onBlur,
  onEnter,
}: {
  value: string;
  readOnly: boolean;
  className: string;
  selectOnMount: boolean;
  onChange: (title: string) => void;
  onBlur: () => void;
  onEnter: () => void;
}) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  // Renames from elsewhere (the grid, another tab) show up unless the title is being edited.
  useEffect(() => {
    if (document.activeElement !== ref.current) {
      setText(value);
    }
  }, [value]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure the height whenever the text changes
  useLayoutEffect(() => {
    const el = ref.current;

    if (!el) {
      return;
    }

    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [text]);
  // A brand-new record starts with its placeholder title selected, so typing replaces it.
  useEffect(() => {
    if (!selectOnMount) {
      return;
    }

    ref.current?.focus();
    ref.current?.select();
  }, [selectOnMount]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={text}
      readOnly={readOnly}
      placeholder={UNTITLED_RECORD_LABEL}
      aria-label="Title"
      className={cn(
        'block w-full resize-none overflow-hidden bg-transparent font-heading font-semibold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40',
        className,
      )}
      onChange={(event) => {
        const next = event.target.value.replace(/\n/g, ' ');
        setText(next);

        // The title is required: an empty one isn't saved, and blur restores the last saved title.
        if (next.trim()) {
          onChange(next);
        }
      }}
      onBlur={() => {
        if (!text.trim()) {
          setText(value);
        }

        onBlur();
      }}
      onKeyDown={(event) => {
        const atEnd = event.currentTarget.selectionStart === text.length;

        if ((event.key === 'Enter' && !event.nativeEvent.isComposing) || (event.key === 'ArrowDown' && atEnd)) {
          event.preventDefault();
          onEnter();
        }
      }}
    />
  );
}
