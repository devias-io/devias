/**
 * The one table of what a manifest declares. The kind is not in the id: every place that holds one (a table, a `block:`
 * or `action:` field) already says what it is, and ids are unique per kind.
 */

export const ENTITY_KINDS = {
  object: { plural: 'objects' },
  field: { plural: 'fields' },
  view: { plural: 'views' },
  layout: { plural: 'layouts' },
  nav: { plural: 'nav' },
  command: { plural: 'commands' },
  block: { plural: 'blocks' },
  page: { plural: 'pages' },
  agent: { plural: 'agents' },
  /** A module's action, or the platform's own operation (`coreIds.actions.update_record`). */
  action: { plural: 'actions' },
  connection: { plural: 'connections' },
  /** Named as the outside service names it, by the event's `name`: `email.delivered`. */
  event: { plural: 'events' },
  policy: { plural: 'policies' },
} as const;

export type EntityKind = keyof typeof ENTITY_KINDS;

export const ENTITY_KIND_NAMES = Object.keys(ENTITY_KINDS) as EntityKind[];
