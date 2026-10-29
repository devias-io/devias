import { definePageComponent } from '@devias/core';
import { ids } from '../../ids';
import { AssetsPage } from './assets-page';

export { AssetsPage };

export const assetsPages = [definePageComponent({ id: ids.pages.assets, path: 'assets', component: AssetsPage })];
