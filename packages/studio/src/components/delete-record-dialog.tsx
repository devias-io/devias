import { cascadeRelationsOf, type ObjectMetadata } from '@devias/core';
import { useSchema } from '../providers/schema';
import { ConfirmDeleteDialog } from './confirm-delete-dialog';

/** "Delete this task?": the confirmation every record page shares. */
export function DeleteRecordDialog({
  object,
  open,
  onOpenChange,
  onConfirm,
}: {
  object: ObjectMetadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  const { index } = useSchema();
  // Records whose relation says `onDelete: cascade` go with this one.
  const cascades = cascadeRelationsOf(index, object);
  const goWith = [...new Set(cascades.map((relation) => relation.object.labelPlural.toLowerCase()))];

  return (
    <ConfirmDeleteDialog
      noun={object.labelSingular.toLowerCase()}
      {...(goWith.length > 0 ? { description: `Its ${goWith.join(' and ')} go with it.` } : {})}
      open={open}
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
    />
  );
}
