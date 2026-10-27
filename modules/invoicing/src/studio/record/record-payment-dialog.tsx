import { localDate } from '@devias/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldLabel,
  Input,
  NativeSelect,
  NativeSelectOption,
} from '@devias/ui';
import { useState } from 'react';
import { PAYMENT_METHOD_VALUES, PAYMENT_METHODS, type PaymentMethod } from '../../manifest';
import { money } from '../shared';

export interface PaymentInput {
  amount: number;
  paid_on: string;
  method: PaymentMethod;
  reference: string;
}

/** Money received against the invoice. Opens with the balance due filled in, so settling it is one click. */
export function RecordPaymentDialog({
  open,
  balance,
  busy,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  balance: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: PaymentInput) => Promise<void>;
}) {
  const [amount, setAmount] = useState(String(balance));
  const [paidOn, setPaidOn] = useState(localDate(new Date()));
  const [method, setMethod] = useState<PaymentMethod>('bank_transfer');
  const [reference, setReference] = useState('');
  const parsed = Number(amount);
  const valid = Number.isFinite(parsed) && parsed > 0 && /^\d{4}-\d{2}-\d{2}$/.test(paidOn);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            Money received against this invoice. The balance due is {money(balance)}; leave the amount as it is to
            settle it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (!valid || busy) {
              return;
            }

            void onSubmit({ amount: parsed, paid_on: paidOn, method, reference: reference.trim() });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="payment-amount">Amount</FieldLabel>
              <Input
                id="payment-amount"
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="payment-date">Paid on</FieldLabel>
              <Input id="payment-date" type="date" value={paidOn} onChange={(event) => setPaidOn(event.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="payment-method">Method</FieldLabel>
              <NativeSelect
                id="payment-method"
                value={method}
                onChange={(event) => {
                  const next = event.target.value;

                  if ((PAYMENT_METHOD_VALUES as readonly string[]).includes(next)) {
                    setMethod(next as PaymentMethod);
                  }
                }}
              >
                {PAYMENT_METHODS.map((option) => (
                  <NativeSelectOption key={option.value} value={option.value}>
                    {option.label}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            <Field>
              <FieldLabel htmlFor="payment-reference">Reference</FieldLabel>
              <Input
                id="payment-reference"
                placeholder="Bank or card reference"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !valid} data-action="confirm-payment">
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
