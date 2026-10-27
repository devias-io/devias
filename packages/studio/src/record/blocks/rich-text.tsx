import { coreIds, defineBlockComponent, fieldRef } from '@devias/core';
import { useEffect, useRef } from 'react';
import { z } from 'zod';
import { RichTextEditor, type RichTextEditorHandle } from '../../editor';
import { useFields } from '../../hooks/use-schema-lookups';
import { DEFAULT_EDIT_DELAY_MS, useRecordPage } from '../record-page-context';

/**
 * One rich-text field written in place: `/` for blocks, `@` to mention records. It saves with the page's other edits,
 * shortly after typing stops and when it loses focus. Clicking below the text continues at its end.
 */
export const richTextBlock = defineBlockComponent({
  id: coreIds.blocks.rich_text,
  label: 'Rich text',
  icon: 'file-text',
  config: z.object({ fieldId: z.string().min(1), autosaveMs: z.number().int().min(0).optional() }),
  surfaces: { record: { frame: false } },
  component: function RichTextBlock({ config, record, object }) {
    const page = useRecordPage();
    const fields = useFields(object.id);
    const field = fieldRef(fields, config.fieldId)?.name ?? config.fieldId;
    const editor = useRef<RichTextEditorHandle | null>(null);
    const { register } = page.focus;
    // Offer the caret to whoever hands it on (the title): the editor's DOM is focused at once, as Tiptap waits a frame.
    useEffect(
      () =>
        register(field, (at) => {
          editor.current?.view.focus();
          editor.current?.commands.focus(at);
        }),
      [register, field],
    );

    if (!record) {
      return null;
    }

    return (
      <div>
        <RichTextEditor
          variant="page"
          className={page.shell === 'split' ? 'min-h-24 text-[14px]' : undefined}
          value={record[field]}
          editable={!page.readOnly}
          editorRef={editor}
          onChange={(doc) => page.edit({ [field]: doc }, { delayMs: config.autosaveMs ?? DEFAULT_EDIT_DELAY_MS })}
          onBlur={page.flush}
        />
        {/* Clicking below the text continues writing at the end. */}
        {!page.readOnly ? (
          // biome-ignore lint/a11y/noStaticElementInteractions: a pointer shortcut; the editor itself is keyboard-reachable
          // biome-ignore lint/a11y/useKeyWithClickEvents: see above
          <div className="min-h-24 cursor-text" onClick={() => editor.current?.commands.focus('end')} />
        ) : null}
      </div>
    );
  },
});
