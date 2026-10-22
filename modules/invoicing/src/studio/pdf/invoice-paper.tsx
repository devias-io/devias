import type { InvoiceDocumentData } from './invoice-data';

/**
 * The invoice as it will print, on screen: a white sheet in the same layout as the PDF. It is plain HTML so it
 * follows every keystroke in the composer; the PDF itself is drawn from the same data.
 */
export function InvoicePaper({ data }: { data: InvoiceDocumentData }) {
  const { issuedBy, billTo, totals } = data;

  return (
    <div
      data-slot="invoice-paper"
      className="aspect-[1/1.2] w-full min-w-0 overflow-hidden rounded-lg bg-white p-6 text-[10px] leading-snug text-[#171714] shadow-lg ring-1 ring-black/10"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="mb-2 size-5 rounded-md bg-[#a3e635]" />
          <div className="truncate text-[11px] font-semibold">{issuedBy.name || '-'}</div>
          {issuedBy.address.map((line) => (
            <div key={line} className="text-[#6b6b63]">
              {line}
            </div>
          ))}
          {issuedBy.taxId ? <div className="text-[#6b6b63]">Tax ID: {issuedBy.taxId}</div> : null}
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold tracking-tight">Invoice</div>
          <div className="text-[#6b6b63]">{data.number}</div>
          <div className="text-[9px] text-[#6b6b63] uppercase">{data.status}</div>
        </div>
      </div>

      <div className="mt-5 flex gap-8">
        <div>
          <div className="mb-0.5 text-[8px] tracking-wider text-[#6b6b63] uppercase">Billed to</div>
          {billTo.company ? <div className="font-semibold">{billTo.company}</div> : null}
          {billTo.contact ? <div>{billTo.contact}</div> : null}
          {!billTo.company && !billTo.contact ? <div className="text-[#6b6b63]">-</div> : null}
        </div>
        <div>
          <div className="mb-0.5 text-[8px] tracking-wider text-[#6b6b63] uppercase">Issued</div>
          <div>{data.issue_date ?? '-'}</div>
        </div>
        <div>
          <div className="mb-0.5 text-[8px] tracking-wider text-[#6b6b63] uppercase">Due</div>
          <div>{data.due_date ?? 'On receipt'}</div>
        </div>
      </div>

      <div className="mt-5 text-xs font-semibold">{data.summary}</div>

      <table className="mt-4 w-full">
        <thead>
          <tr className="border-b border-[#171714] text-left text-[8px] tracking-wider text-[#6b6b63] uppercase">
            <th className="pb-1 font-normal">Description</th>
            <th className="pb-1 text-right font-normal">Qty</th>
            <th className="pb-1 text-right font-normal">Unit price</th>
            <th className="pb-1 text-right font-normal">Tax</th>
            <th className="pb-1 text-right font-normal">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.lines.length === 0 ? (
            <tr>
              <td colSpan={5} className="py-3 text-[#6b6b63]">
                No items yet.
              </td>
            </tr>
          ) : (
            data.lines.map((line, index) => (
              <tr key={`${index}-${line.description}`} className="border-b border-[#e4e4de]">
                <td className="py-1.5 pr-2">{line.description}</td>
                <td className="py-1.5 text-right tabular-nums">{line.quantity}</td>
                <td className="py-1.5 text-right tabular-nums">{line.unit_price}</td>
                <td className="py-1.5 text-right tabular-nums">{line.tax}</td>
                <td className="py-1.5 text-right tabular-nums">{line.amount}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <dl className="mt-3 ml-auto w-3/5 text-[10px]">
        {(
          [
            ['Subtotal', totals.subtotal],
            ...(totals.discount ? [['Discount', totals.discount] as [string, string]] : []),
            ['Tax', totals.tax],
            ['Total', totals.total],
            ['Amount paid', totals.paid],
          ] as [string, string][]
        ).map(([label, value]) => (
          <div key={label} className="flex justify-between py-0.5">
            <dt className="text-[#6b6b63]">{label}</dt>
            <dd className="tabular-nums">{value}</dd>
          </div>
        ))}
        <div className="mt-1 flex justify-between border-t border-[#171714] pt-1.5 text-xs font-semibold">
          <dt>Amount due</dt>
          <dd className="tabular-nums">{totals.due}</dd>
        </div>
      </dl>

      {data.waysToPay.length > 0 ? (
        <div className="mt-4">
          <div className="mb-0.5 text-[8px] tracking-wider text-[#6b6b63] uppercase">Ways to pay</div>
          <div>{data.waysToPay.join(' · ')}</div>
        </div>
      ) : null}
      {data.payOnline ? (
        <div className="mt-3" data-slot="pay-online">
          <div className="mb-0.5 text-[8px] tracking-wider text-[#6b6b63] uppercase">Pay online</div>
          <div className="break-all">{data.payOnline}</div>
        </div>
      ) : null}
      {data.notes ? (
        <div className="mt-3">
          <div className="mb-0.5 text-[8px] tracking-wider text-[#6b6b63] uppercase">Notes</div>
          <div className="whitespace-pre-wrap">{data.notes}</div>
        </div>
      ) : null}
    </div>
  );
}
