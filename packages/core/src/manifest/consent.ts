import { z } from 'zod';
import { IdSchema, MODULE_ID_PATTERN } from '../ids';

/**
 * What installing a module asks a workspace to agree to: who publishes it and its default policies. Shown before an install and to the agent; only validated and displayed for now.
 */

export const ModulePublisherSchema = z
  .object({
    /** Who it is, whatever it is called: `devias`. Stable, like every id. */
    id: z.string().regex(MODULE_ID_PATTERN, 'A publisher id is lowercase letters, digits and "-"'),
    name: z.string().min(1),
    /** Linked from the studio, so only http(s). */
    url: z.url({ protocol: /^https?$/ }).optional(),
  })
  .meta({ id: 'ModulePublisher' });
export type ModulePublisher = z.infer<typeof ModulePublisherSchema>;

export const ModuleEnginesSchema = z
  .object({
    /** A semver range of the Devias versions the module works with. Stored and shown; nothing checks it yet. */
    devias: z.string().min(1),
  })
  .meta({ id: 'ModuleEngines' });
export type ModuleEngines = z.infer<typeof ModuleEnginesSchema>;

export const POLICY_DECISIONS = ['auto', 'review', 'deny'] as const;
export type PolicyDecision = (typeof POLICY_DECISIONS)[number];

/**
 * @experimental A default for what an agent may do without review: when `match` (and `when`, if given) fits a write,
 * `decision` says whether it applies directly, waits for review or is refused. Data only: nothing enforces it yet,
 * and the trust layer will settle its final shape.
 */
export const PolicyDefinitionSchema = z
  .object({
    id: IdSchema,
    description: z.string().min(1),
    match: z.object({
      /** An action's address: `invoicing.add_payment`, `core.delete_record`. */
      actionId: z.string().min(1).optional(),
      objectId: IdSchema.optional(),
      /** The id of a field of `objectId`. */
      fieldId: z.string().min(1).optional(),
    }),
    /** Only when this field's value is above the amount, for thresholds such as "invoices over 5,000". */
    when: z.object({ fieldId: z.string().min(1), above: z.number() }).optional(),
    decision: z.enum(POLICY_DECISIONS),
  })
  .meta({ id: 'PolicyDefinition' });
export type PolicyDefinition = z.infer<typeof PolicyDefinitionSchema>;
