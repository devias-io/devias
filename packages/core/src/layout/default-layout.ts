import { coreIds } from '../core-ids';
import type { FieldMetadata, ObjectMetadata, SchemaIndex, TabsLayout } from '../metadata/schema';

/**
 * When an object has no layout, the studio renders this one: a Details tab with all the fields, then Comments and
 * Activity tabs, then one tab of related records per inverse relation pointing at this object.
 */
export const generateDefaultLayout = (index: SchemaIndex, object: ObjectMetadata): TabsLayout => {
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const inverse = inverseRelationsOf(index, object);

  return {
    workspaceId: object.workspaceId,
    objectId: object.id,
    id: `core.${object.nameSingular}.default`,
    label: 'Default',
    kind: 'record',
    shell: 'tabs',
    isDefault: true,
    moduleId: null,
    actions: [],
    tabs: [
      // Alone in its tab, a block needs no heading of its own: the tab names it.
      {
        name: 'details',
        label: 'Details',
        blocks: [
          {
            name: 'fields',
            blockId: coreIds.blocks.fields,
            columnSpan: 6,
            config: { fieldIds: fields.map((f) => f.id) },
          },
        ],
      },
      { name: 'comments', label: 'Comments', blocks: [{ name: 'comments', blockId: coreIds.blocks.comments }] },
      {
        name: 'activity',
        label: 'Activity',
        blocks: [{ name: 'activity', blockId: coreIds.blocks.activity }],
      },
      ...inverse.map((rel) => {
        const name = `related-${rel.sourceObject.nameSingular}-${rel.field.name}`;

        return {
          name,
          label: rel.label,
          blocks: [
            {
              name,
              blockId: coreIds.blocks.related_records,
              config: { objectId: rel.sourceObject.id, fieldId: rel.field.id },
            },
          ],
        };
      }),
    ],
  };
};

export interface InverseRelation {
  sourceObject: ObjectMetadata;
  field: FieldMetadata;
  label: string;
}

/** Relations on other objects that point at `object` (the one-to-many side). */
export const inverseRelationsOf = (index: SchemaIndex, object: ObjectMetadata): InverseRelation[] => {
  const out: InverseRelation[] = [];

  for (const field of index.schema.fields) {
    if (field.type !== 'relation') {
      continue;
    }

    const settings = field.settings as { targetObjectId?: string; inverseLabel?: string };

    if (settings.targetObjectId !== object.id) {
      continue;
    }

    const sourceObject = index.objectsById.get(field.objectId);

    if (!sourceObject) {
      continue;
    }

    out.push({ sourceObject, field, label: settings.inverseLabel ?? sourceObject.labelPlural });
  }

  return out;
};
