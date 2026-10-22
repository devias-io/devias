import { useSchema } from '@devias/studio';
import { ids } from '../manifest';

/** Quote amounts in the currency of the quote's total field, to the cent. */
export const useQuoteMoney = () => {
  const { index } = useSchema();
  const quote = index.objectsById.get(ids.objects.quote);
  const total = (quote ? index.fieldsByObjectId.get(quote.id) : undefined)?.find((field) => field.name === 'total');
  const currency = (total?.settings as { currencyCode?: string } | undefined)?.currencyCode ?? 'EUR';
  const format = new Intl.NumberFormat(undefined, { style: 'currency', currency });

  return (value: number) => format.format(value);
};
