import type { FieldMetadata, ObjectMetadata, RecordData } from '@devias/core';
import { EditableValue, getFieldType, useFieldTypes } from '@devias/studio';

/** One field of a record, shown as its value or, when `editable`, as a click-to-edit value. */
export function Value({
  name,
  fields,
  record,
  object,
  editable,
  onCommit,
}: {
  name: string;
  fields: FieldMetadata[];
  record: RecordData;
  object: ObjectMetadata;
  editable: boolean;
  onCommit: (name: string, value: unknown) => void;
}) {
  const fieldTypes = useFieldTypes();
  const field = fields.find((candidate) => candidate.name === name);

  if (!field) {
    return <span className="text-xs text-muted-foreground">-</span>;
  }

  return (
    <EditableValue
      field={field}
      fieldType={getFieldType(fieldTypes, field.type)}
      record={record}
      object={object}
      editable={editable}
      onCommit={(value) => onCommit(name, value)}
    />
  );
}
