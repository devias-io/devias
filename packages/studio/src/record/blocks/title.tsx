import { coreIds, defineBlockComponent, fieldRef, primaryFieldOf } from '@devias/core';
import { z } from 'zod';
import { TitleField } from '../../components/title-field';
import { useSchema } from '../../providers/schema';
import { UNTITLED_RECORD_LABEL } from '../../views/view-state';
import { DEFAULT_EDIT_DELAY_MS, useRecordPage } from '../record-page-context';

/**
 * The record's title as a heading you edit in place, saved with the page's other edits. As a `tabs` layout's `header`
 * it draws the page header; in a `column` or `split` layout it is the first block of the column.
 */
export const titleBlock = defineBlockComponent({
  id: coreIds.blocks.title,
  label: 'Title',
  icon: 'heading',
  config: z.object({ fieldId: z.string().optional(), autosaveMs: z.number().int().min(0).optional() }),
  surfaces: { record: { frame: false } },
  component: function TitleBlock({ config, record, object }) {
    const { index } = useSchema();
    const page = useRecordPage();
    const fields = object ? (index.fieldsByObjectId.get(object.id) ?? []) : [];
    const field = config.fieldId
      ? (fieldRef(fields, config.fieldId)?.name ?? config.fieldId)
      : object
        ? primaryFieldOf(index, object)?.name
        : undefined;

    if (!field || !record) {
      return null;
    }

    const value = typeof record[field] === 'string' ? (record[field] as string) : '';
    // Untouched since it was made, still on its placeholder: a record that was just created.
    const fresh = value === UNTITLED_RECORD_LABEL && record.created_at === record.updated_at;

    return (
      <TitleField
        value={value}
        readOnly={page.readOnly}
        className={page.shell === 'split' ? 'text-xl' : 'text-2xl'}
        selectOnMount={fresh && !page.readOnly}
        onChange={(next) => page.edit({ [field]: next }, { delayMs: config.autosaveMs ?? DEFAULT_EDIT_DELAY_MS })}
        onBlur={page.flush}
        onEnter={() => page.focus.request('start')}
      />
    );
  },
});
