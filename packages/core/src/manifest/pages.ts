import { z } from 'zod';
import { IdSchema } from '../ids';

/**
 * A page a module ships, declared in its manifest. The component and its route live in the module's studio code; the
 * declaration is the data the server can see, so a nav item or a command can point at the page by id, and the studio
 * takes the page's label and icon from it. A page nothing points at (a route with parameters) needs no declaration.
 */
export const PageDeclarationSchema = z
  .object({
    id: IdSchema,
    /** The palette, breadcrumbs and the not-installed message. */
    label: z.string().min(1),
    icon: z.string().optional(),
  })
  .meta({ id: 'PageDeclaration' });
export type PageDeclaration = z.infer<typeof PageDeclarationSchema>;
