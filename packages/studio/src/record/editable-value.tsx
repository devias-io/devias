import type { FieldMetadata, FieldTypeDefinition, ObjectMetadata, RecordData } from '@devias/core';
import { cn, Icon } from '@devias/ui';
import { useRef, useState } from 'react';

/**
 * The editors are tuned for a table cell (28px tall, text 11px in). Here the editor takes the place of the value and
 * must not move it: the same 32px box and radius as the hovered value, its text in the same place (6px in, counting
 * the border).
 */
const SAME_BOX =
  '[&_[data-slot=input-group]]:h-8 [&_[data-slot=input]]:h-8 [&_[data-slot=input]]:px-[5px] [&_[data-slot=select-trigger]]:h-8 [&_[data-slot=select-trigger]]:pl-[5px] [&_[data-slot=textarea]]:px-[5px]';

/**
 * A record value that turns into the field type's inline editor on click / Enter. An editable one shows a small pen at
 * its right end while it is hovered or focused, so it is clear it can be changed (links, whose text opens the link, too).
 */
export function EditableValue({
  field,
  fieldType,
  record,
  object,
  editable,
  align = 'start',
  onCommit,
}: {
  field: FieldMetadata;
  fieldType: FieldTypeDefinition;
  record: RecordData;
  object: ObjectMetadata;
  editable: boolean;
  /** Which end the value sits at: `end` for a number in a right-aligned column, with no pen to push it away. */
  align?: 'start' | 'end';
  onCommit: (value: unknown) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(null);
  const draftRef = useRef<unknown>(null);
  const done = useRef(false);
  const current = record[field.name] ?? null;
  const start = () => {
    if (!editable) {
      return;
    }

    setDraft(current);
    draftRef.current = current;
    done.current = false;
    setEditing(true);
  };

  if (editing) {
    const Editor = fieldType.editor;

    return (
      <div className={cn('w-full', SAME_BOX)}>
        <Editor
          field={field as FieldMetadata & { settings: Record<string, unknown> }}
          value={draft}
          onChange={(value) => {
            setDraft(value);
            draftRef.current = value;
          }}
          mode="inline"
          autoFocus
          record={record}
          object={object}
          onCommit={() => {
            if (done.current) {
              return;
            }

            done.current = true;
            setEditing(false);

            if (draftRef.current !== current) {
              onCommit(draftRef.current);
            }
          }}
          onCancel={() => {
            if (done.current) {
              return;
            }

            done.current = true;
            setEditing(false);
          }}
        />
      </div>
    );
  }

  const Display = fieldType.display ?? fieldType.cell;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: role="button" and tabIndex are set when editable
    <div
      role={editable ? 'button' : undefined}
      tabIndex={editable ? 0 : undefined}
      className={cn(
        'flex min-h-8 w-full min-w-0 items-center gap-2 rounded-md border border-transparent px-[5px] text-xs',
        align === 'end' && 'justify-end',
        editable &&
          'group/editable cursor-text outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/60',
      )}
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          start();
        }
      }}
    >
      <Display
        field={field as FieldMetadata & { settings: Record<string, unknown> }}
        value={current}
        record={record}
        object={object}
      />
      {editable && align !== 'end' ? (
        <Icon
          name="pencil"
          aria-hidden
          data-slot="edit-hint"
          className="ms-auto size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover/editable:opacity-100 group-focus-visible/editable:opacity-100"
        />
      ) : null}
    </div>
  );
}
