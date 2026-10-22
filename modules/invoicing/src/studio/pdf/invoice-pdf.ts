import type { DocumentProps } from '@react-pdf/renderer';
import { createElement, type ReactElement } from 'react';
import type { InvoiceDocumentData } from './invoice-data';

/** The invoice as a PDF file. The PDF library is large, so it is only loaded when one is made. */
export const renderInvoicePdf = async (data: InvoiceDocumentData): Promise<Blob> => {
  const [{ pdf }, { InvoiceDocument }] = await Promise.all([
    import('@react-pdf/renderer'),
    import('./invoice-document'),
  ]);

  // `InvoiceDocument` renders a react-pdf `Document`, which is what `pdf` wants.
  return pdf(createElement(InvoiceDocument, { data }) as unknown as ReactElement<DocumentProps>).toBlob();
};

/** Hand a blob to the browser as a download. */
export const saveBlob = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
