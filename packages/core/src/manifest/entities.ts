/**
 * The one table of what a manifest declares and how each kind is named. An id is `<owner>.<key>`; a field, view or
 * layout is named inside its object (`<owner>.<object>.<key>`). The kind is not in the id: every place that holds one
 * (a table, a `block:` or `action:` field) already says what it is. Everything that builds or reads an id goes
 * through here, so the format is written once.
 */

export const ENTITY_KINDS = {
  object: { plural: 'objects', scoped: false },
  field: { plural: 'fields', scoped: true },
  view: { plural: 'views', scoped: true },
  layout: { plural: 'layouts', scoped: true },
  nav: { plural: 'nav', scoped: false },
  command: { plural: 'commands', scoped: false },
  block: { plural: 'blocks', scoped: false },
  page: { plural: 'pages', scoped: false },
  agent: { plural: 'agents', scoped: false },
  /** A module's `crm.enrich_person`, or the platform's own operation: `core.update_record`. */
  action: { plural: 'actions', scoped: false },
  connection: { plural: 'connections', scoped: false },
  /** The outside service's own name for it, as its webhook reports it: `email-resend.email.delivered`. */
  event: { plural: 'events', scoped: false },
  policy: { plural: 'policies', scoped: false },
} as const;

export type EntityKind = keyof typeof ENTITY_KINDS;

export const ENTITY_KIND_NAMES = Object.keys(ENTITY_KINDS) as EntityKind[];

/** `<owner>.<key>`, or `<owner>.<scope>.<key>` for a kind named inside its object. */
export const deriveId = (owner: string, key: string, scope?: string): string =>
  scope === undefined ? `${owner}.${key}` : `${owner}.${scope}.${key}`;

/** Who owns an id: `crm` for `crm.enrich_person`, `core` for the platform's operations; empty when it is not one. */
export const ownerOfId = (id: string): string => (id.includes('.') ? id.slice(0, id.indexOf('.')) : '');

/** What follows the owner: `person.email` for `crm.person.email`, `enrichPerson` for `crm.enrich_person`. */
export const localOfId = (id: string): string => (id.includes('.') ? id.slice(id.indexOf('.') + 1) : id);

/** What a declaration is called inside its owner, for a kind not named inside an object: `enrichPerson` for `crm.enrich_person`. */
export const keyOfId = localOfId;

/** The object and the key of a field, view or layout id: `crm.person.email` is `person` and `email`. */
export const scopedKeyOfId = (id: string): { scope: string; key: string } => {
  const local = localOfId(id);
  const dot = local.indexOf('.');

  return dot < 0 ? { scope: '', key: local } : { scope: local.slice(0, dot), key: local.slice(dot + 1) };
};

/** The id of an action: a module's (`crm.enrich_person`) or the platform's (`core.update_record`). */
export const actionAddress = (owner: string, key: string): string => deriveId(owner, key);
