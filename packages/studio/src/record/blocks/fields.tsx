import { coreIds, defineBlockComponent, type FieldMetadata, fieldRef } from '@devias/core';
import { Icon } from '@devias/ui';
import { useState } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { useUpdateRecord } from '../../hooks/use-mutations';
import { useFields } from '../../hooks/use-schema-lookups';
import { getFieldType, useFieldTypes } from '../../registries';
import { EditableValue } from '../editable-value';

/** The field types whose value is worth copying: an address, a number, a link. */
const COPYABLE = new Set(['email', 'phone', 'url']);

const isEmpty = (value: unknown) =>
  value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);

/**
 * The configured fields (default: all) as label and value pairs, the label quiet, the value editable in place. An
 * address, a number or a link has a copy button that shows on hover. With `collapseEmpty`, fields with no value wait
 * behind one line that names them, so a long profile stays short.
 */
export const fieldsBlock = defineBlockComponent({
  id: coreIds.blocks.fields,
  label: 'Fields',
  icon: 'rows-3',
  config: z.object({ fieldIds: z.array(z.string()).optional(), collapseEmpty: z.boolean().optional() }),
  surfaces: { record: { flush: true } },
  component: ({ config, record, object }) => {
    const fieldTypes = useFieldTypes();
    const all = useFields(object.id);
    const update = useUpdateRecord(object.nameSingular);
    const [showEmpty, setShowEmpty] = useState(false);
    // A field is listed by id; the agent and the API may name it by its API name.
    const fields = config.fieldIds
      ? config.fieldIds.map((ref) => fieldRef(all, ref)).filter((f): f is FieldMetadata => Boolean(f))
      : all;

    if (fields.length === 0) {
      return <div className="text-xs text-muted-foreground">No fields configured.</div>;
    }

    const hidden = config.collapseEmpty && !showEmpty ? fields.filter((field) => isEmpty(record[field.name])) : [];
    const shown = fields.filter((field) => !hidden.includes(field));
    const emptyCount = config.collapseEmpty ? fields.filter((field) => isEmpty(record[field.name])).length : 0;

    return (
      <div data-slot="fields">
        <dl className="flex flex-col" data-slot="field-rows">
          {shown.map((field) => {
            const value = record[field.name];

            return (
              <div
                key={field.name}
                className="group/row grid grid-cols-[minmax(6.5rem,40%)_minmax(0,1fr)] items-center gap-x-3"
              >
                <dt className="truncate text-xs text-muted-foreground">{field.label}</dt>
                <dd className="-mx-1.5 flex min-w-0 items-center">
                  <div className="min-w-0 flex-1">
                    <EditableValue
                      field={field}
                      fieldType={getFieldType(fieldTypes, field.type)}
                      record={record}
                      object={object}
                      editable={!object.readOnly}
                      onCommit={(next) => void update.mutateAsync({ id: record.id, patch: { [field.name]: next } })}
                    />
                  </div>
                  {COPYABLE.has(field.type) && typeof value === 'string' && value ? (
                    <button
                      type="button"
                      aria-label={`Copy ${field.label}`}
                      data-slot="copy-value"
                      className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover/row:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                      onClick={() => {
                        void navigator.clipboard
                          ?.writeText(value)
                          .then(() => toast.success(`${field.label} copied`))
                          .catch(() => toast.error('Could not copy'));
                      }}
                    >
                      <Icon name="copy" className="size-3.5" />
                    </button>
                  ) : null}
                </dd>
              </div>
            );
          })}
        </dl>
        {emptyCount > 0 ? (
          <button
            type="button"
            data-slot="empty-fields"
            className="mt-1 inline-flex h-7 items-center gap-1.5 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowEmpty((open) => !open)}
          >
            <Icon name={showEmpty ? 'chevron-up' : 'plus'} className="size-3.5" />
            {showEmpty
              ? 'Hide empty fields'
              : `Add ${hidden
                  .slice(0, 3)
                  .map((field) => field.label)
                  .join(', ')}${hidden.length > 3 ? ` +${hidden.length - 3}` : ''}`}
          </button>
        ) : null}
      </div>
    );
  },
});
