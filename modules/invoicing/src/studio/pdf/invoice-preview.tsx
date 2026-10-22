import type { RecordData } from '@devias/core';
import { useLabels, useWorkspace } from '@devias/studio';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Skeleton,
} from '@devias/ui';
import { useEffect, useState } from 'react';
import { text } from '../shared';
import { buildInvoiceDocument } from './invoice-data';
import { renderInvoicePdf } from './invoice-pdf';

/**
 * The invoice as a PDF, shown in a dialog and ready to download. The PDF library is large, so it is only loaded
 * when someone opens the preview.
 */
export function InvoicePreviewDialog({
  invoice,
  lines,
  payments,
  onClose,
}: {
  invoice: RecordData;
  lines: readonly RecordData[];
  payments: readonly RecordData[];
  onClose: () => void;
}) {
  const labels = useLabels();
  const { organization } = useWorkspace();
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const number = text(invoice.number) ?? invoice.id;
  const companyId = text(invoice.company);
  const contactId = text(invoice.contact);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the dialog is keyed by what it shows; it renders once per open
  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    (async () => {
      try {
        const [company, contact] = await Promise.all([
          companyId ? labels.get('company')?.load([companyId]) : undefined,
          contactId ? labels.get('person')?.load([contactId]) : undefined,
        ]);
        const data = buildInvoiceDocument({
          issuer: organization.name,
          invoice,
          lines,
          payments,
          names: {
            company: companyId ? (company?.[companyId] ?? null) : null,
            contact: contactId ? (contact?.[contactId] ?? null) : null,
          },
        });
        const blob = await renderInvoicePdf(data);

        if (cancelled) {
          return;
        }

        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      } catch {
        if (!cancelled) {
          setFailed(true);
        }
      }
    })();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, []);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-5xl" data-slot="invoice-preview">
        <DialogHeader className="gap-1 p-5 pr-12">
          <DialogTitle>Invoice {number}</DialogTitle>
          <DialogDescription>A preview of the PDF you can download or send to your customer.</DialogDescription>
        </DialogHeader>
        <div className="h-[min(52rem,78vh)] bg-muted/50">
          {failed ? (
            <div className="flex h-full items-center justify-center p-6 text-xs text-destructive">
              The PDF could not be generated.
            </div>
          ) : url ? (
            <iframe
              title={`Invoice ${number}`}
              src={`${url}#toolbar=0&navpanes=0&view=FitH`}
              className="size-full border-0"
            />
          ) : (
            <div className="p-6">
              <Skeleton className="h-full min-h-96 w-full" />
            </div>
          )}
        </div>
        <DialogFooter className="mx-0 mb-0 items-center px-5 py-3">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={!url}
            render={<a href={url ?? undefined} download={`Invoice-${number}.pdf`} />}
            nativeButton={false}
          >
            <Icon name="download" />
            Download PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
