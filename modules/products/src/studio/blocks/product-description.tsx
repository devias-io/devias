import { defineBlockComponent } from '@devias/core';
import { EditableValue, getFieldType, useFields, useFieldTypes, useRecordPage, useUpdateRecord } from '@devias/studio';
import { ids } from '../../manifest';

/** What the customer reads about the product: plain text, edited in place, as wide as the page's column. */
export const productDescriptionBlock = defineBlockComponent({
  id: ids.blocks.product_description,
  label: 'Description',
  icon: 'text',
  surfaces: { record: { objectIds: [ids.objects.product], frame: false } },
  component: function ProductDescription() {
    const { object, record, readOnly } = useRecordPage();
    const fields = useFields(object.id);
    const fieldTypes = useFieldTypes();
    const update = useUpdateRecord(object.nameSingular);
    const field = fields.find((candidate) => candidate.name === 'description');

    if (!field) {
      return null;
    }

    return (
      <div className="-mx-1.5" data-slot="product-description">
        <EditableValue
          field={field}
          fieldType={getFieldType(fieldTypes, field.type)}
          record={record}
          object={object}
          editable={!readOnly}
          onCommit={(value) => update.mutate({ id: record.id, patch: { description: value } })}
        />
      </div>
    );
  },
});
