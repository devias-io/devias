import { definePage } from '@devias/core';
import { ids } from './ids';

/** The pages the module's studio code registers that a nav item or a command points at. */
export const pages = [definePage({ id: ids.pages.forecast, label: 'Forecast', icon: 'trending-up' })];
