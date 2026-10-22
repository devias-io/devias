import { dataModelAdapters } from './data-model';
import { documentAdapters } from './documents';
import { metadataAdapters } from './metadata';
import { recordAdapters } from './records';
import { taskAdapters } from './tasks';
import type { ToolAdapters } from './types';
import { workflowAdapters } from './workflows';

/** What is specific to a model about the platform's actions, by action id. */
export const builtinAdapters: ToolAdapters = {
  ...documentAdapters,
  ...dataModelAdapters,
  ...metadataAdapters,
  ...recordAdapters,
  ...taskAdapters,
  ...workflowAdapters,
};
