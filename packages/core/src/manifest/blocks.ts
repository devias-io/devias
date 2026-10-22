import { z } from 'zod';
import { IdSchema } from '../ids';

/**
 * A block a module ships, declared in its manifest. The component lives in the module's studio code; the declaration
 * is the data the server and the agent can see, so layouts are checked against real blocks and the agent can
 * pick one without reading the studio's registry.
 */
export const BlockDeclarationSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
    /** What it shows, and the config a layout cell passes it. The agent reads this to place it. */
    description: z.string().optional(),
    /** Where it renders; only `record` blocks can be placed in a layout. */
    surfaces: z.array(z.enum(['record', 'home', 'dialog', 'panel', 'approval'])).min(1),
  })
  .meta({ id: 'BlockDeclaration' });
export type BlockDeclaration = z.infer<typeof BlockDeclarationSchema>;
