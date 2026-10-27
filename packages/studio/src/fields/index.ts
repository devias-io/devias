import type { AnyFieldType } from '@devias/core';
import { booleanFieldType } from './boolean';
import { currencyFieldType } from './currency';
import { dateFieldType, dateTimeFieldType } from './date';
import { jsonFieldType } from './json';
import { emailFieldType, phoneFieldType, urlFieldType } from './links';
import { memberFieldType } from './member';
import { moneyFieldType, numberFieldType } from './number';
import { relationFieldType } from './relation';
import { richTextFieldType } from './rich-text';
import { multiSelectFieldType, selectFieldType } from './select';
import { textFieldType } from './text';

export const builtinFieldTypes: AnyFieldType[] = [
  textFieldType,
  numberFieldType,
  moneyFieldType,
  currencyFieldType,
  booleanFieldType,
  dateFieldType,
  dateTimeFieldType,
  selectFieldType,
  multiSelectFieldType,
  emailFieldType,
  phoneFieldType,
  urlFieldType,
  relationFieldType,
  memberFieldType,
  richTextFieldType,
  jsonFieldType,
];

export { formatDate } from './date';
export { FilterValueInput, opNeedsValue } from './filter-input';
export { externalHref, RecordImage, shortAddress } from './links';
export { OptionsEditor } from './options-editor';
export { formatCurrency, formatNumber, OptionBadge, OptionLabel, optionColorClass, optionsOf } from './shared';
export {
  booleanFieldType,
  currencyFieldType,
  dateFieldType,
  dateTimeFieldType,
  emailFieldType,
  jsonFieldType,
  memberFieldType,
  moneyFieldType,
  multiSelectFieldType,
  numberFieldType,
  phoneFieldType,
  relationFieldType,
  richTextFieldType,
  selectFieldType,
  textFieldType,
  urlFieldType,
};
