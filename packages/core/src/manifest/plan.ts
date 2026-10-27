import { z } from 'zod';
import { IdSchema } from '../ids';
import { MANIFEST_ENTITY_KINDS } from './manifest';

export const PlanActionSchema = z.enum(['create', 'update', 'delete', 'noop', 'conflict']);
export type PlanAction = z.infer<typeof PlanActionSchema>;

export const PlanChangeSchema = z
  .object({
    kind: z.enum(MANIFEST_ENTITY_KINDS),
    id: IdSchema,
    label: z.string(),
    action: PlanActionSchema,
    destructive: z.boolean(),
    reason: z.string().optional(),
    /** Attribute-level diff for updates: `{ attr: { from, to } }`. */
    diff: z.record(z.string(), z.object({ from: z.unknown(), to: z.unknown() })).optional(),
  })
  .meta({ id: 'PlanChange' });
export type PlanChange = z.infer<typeof PlanChangeSchema>;

export const PlanResultSchema = z
  .object({
    moduleId: z.string(),
    fromVersion: z.string().nullable(),
    toVersion: z.string(),
    manifestHash: z.string(),
    /** Hash of the change list; `apply` can require it to match so a reviewed plan is what gets applied. */
    planHash: z.string(),
    hasDestructive: z.boolean(),
    hasConflicts: z.boolean(),
    changes: z.array(PlanChangeSchema),
  })
  .meta({ id: 'PlanResult' });
export type PlanResult = z.infer<typeof PlanResultSchema>;

export const ApplyOptionsSchema = z.object({
  expectedPlanHash: z.string().optional(),
  allowDestructive: z.boolean().optional(),
});
export type ApplyOptions = z.infer<typeof ApplyOptionsSchema>;

export const ApplyResultSchema = z
  .object({
    moduleId: z.string(),
    version: z.string(),
    manifestHash: z.string(),
    metadataVersion: z.number().int(),
    applied: z.array(PlanChangeSchema),
  })
  .meta({ id: 'ApplyResult' });
export type ApplyResult = z.infer<typeof ApplyResultSchema>;

export const summarizePlan = (plan: Pick<PlanResult, 'changes'>) => {
  const counts = { create: 0, update: 0, delete: 0, noop: 0, conflict: 0 } as Record<PlanAction, number>;

  for (const change of plan.changes) {
    counts[change.action] += 1;
  }

  return counts;
};
