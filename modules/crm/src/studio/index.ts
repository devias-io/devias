import { defineModuleStudio } from '@devias/core';
import { manifest } from '../manifest';
import { companySummaryBlock } from './blocks/company-summary';
import { dealStageBlock } from './blocks/deal-stage';
import { newThisWeekBlock } from './blocks/new-this-week';
import { overviewBlock } from './blocks/overview';
import { personSummaryBlock } from './blocks/person-summary';
import { pipelineBlock } from './blocks/pipeline';
import { ratingFieldType } from './fields/rating-field';
import { forecastPages } from './pages/forecast';

declare module '@devias/core' {
  interface FieldValueMap {
    rating: number;
  }
}

/**
 * The built-in CRM as a module: its manifest, the `rating` field type, the person summary, company summary and overview
 * blocks, the deal page's stage block, the Home blocks (pipeline, new this week) and the Forecast
 * pages.
 */
export const crm = defineModuleStudio(manifest, {
  fieldTypes: [ratingFieldType],
  blocks: [personSummaryBlock, companySummaryBlock, overviewBlock, dealStageBlock, pipelineBlock, newThisWeekBlock],
  pages: forecastPages,
});

export default crm;
