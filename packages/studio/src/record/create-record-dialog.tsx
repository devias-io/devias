import type { ObjectMetadata, RecordData } from '@devias/core';
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@devias/ui';
import { toast } from 'sonner';
import { useCreateRecord } from '../hooks/use-mutations';
import { useNavigateTo } from '../hooks/use-navigate-to';
import { RecordForm } from './record-form';

export interface CreateRecordDialogProps {
  object: ObjectMetadata;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<RecordData>;
  /** Called after creation; when omitted the studio navigates to the new record. */
  onCreated?: (record: RecordData) => void;
}

const FORM_ID = 'create-record-form';

export function CreateRecordDialog({ object, open, onOpenChange, initial, onCreated }: CreateRecordDialogProps) {
  const create = useCreateRecord(object.nameSingular);
  const nav = useNavigateTo();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Header and footer stay put; only the fields scroll. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-lg">
        <DialogHeader className="shrink-0 px-5 pt-5 pb-4">
          <DialogTitle>New {object.labelSingular.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {object.description ?? `Create a ${object.labelSingular.toLowerCase()}.`}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pt-1 pb-5">
          <RecordForm
            id={FORM_ID}
            object={object}
            initial={initial}
            onSubmit={async (values) => {
              const record = await create.mutateAsync(values);
              toast.success(`${object.labelSingular} created`);
              onOpenChange(false);

              if (onCreated) {
                onCreated(record);
              } else {
                nav.toRecord(object.nameSingular, record.id);
              }
            }}
          />
        </div>
        <DialogFooter className="m-0 shrink-0 px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={FORM_ID} disabled={create.isPending}>
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
