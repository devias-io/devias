import { defineFieldType, type FieldEditorProps } from '@devias/core';
import { Button, cn, Popover, PopoverContent, PopoverTrigger } from '@devias/ui';
import { useRef, useState } from 'react';
import { plainText, type RichTextDoc } from '../editor/rich-text';
import { RichTextEditor } from '../editor/rich-text-editor';

declare module '@devias/core' {
  interface FieldValueMap {
    rich_text: RichTextDoc;
  }
}

const Empty = () => (
  <span data-slot="empty-value" className="text-muted-foreground">
    —
  </span>
);

const hasText = (value: unknown): boolean => plainText(value).length > 0;

/** Table cells and inline edits: a one-line preview that opens the editor in a popover. */
function InlineEditor({ value, onChange, onCommit, onCancel, disabled }: FieldEditorProps<RichTextDoc>) {
  const [open, setOpen] = useState(true);
  const changed = useRef(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);

        if (!next) {
          (changed.current ? onCommit : onCancel)?.();
        }
      }}
    >
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="sm"
            className={cn('w-full justify-start font-normal', !hasText(value) && 'text-muted-foreground')}
            disabled={disabled}
          />
        }
      >
        <span className="truncate">{plainText(value).replace(/\n/g, ' ') || 'Empty'}</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-3">
        <RichTextEditor
          value={value}
          autoFocus
          onChange={(doc) => {
            changed.current = true;
            onChange(doc);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** Rich text stored as Tiptap JSON. `/` inserts blocks and `@` mentions records, which show as links. */
export const richTextFieldType = defineFieldType<RichTextDoc>({
  type: 'rich_text',
  label: 'Rich text',
  icon: 'file-text',
  category: 'advanced',
  cell: ({ value }) => {
    const text = plainText(value).replace(/\n/g, ' ');

    return text ? <span className="truncate text-muted-foreground">{text}</span> : <Empty />;
  },
  display: ({ value }) => (hasText(value) ? <RichTextEditor value={value} editable={false} /> : <Empty />),
  editor: (props) =>
    props.mode === 'inline' ? (
      <InlineEditor {...props} />
    ) : (
      <div
        className={cn(
          'rounded-lg border border-input bg-transparent px-2.5 py-1.5 transition-colors hover:border-ring dark:bg-input/30',
          'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
          props.invalid && 'border-destructive',
        )}
      >
        <RichTextEditor
          value={props.value}
          editable={!props.disabled}
          autoFocus={props.autoFocus}
          onChange={props.onChange}
        />
      </div>
    ),
  filter: { operators: ['is_empty', 'is_not_empty'] },
  sortable: false,
  groupable: false,
  searchable: false,
  toText: (value) => plainText(value),
});
