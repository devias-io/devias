/**
 * Neutral manifests for the packages' tests. The packages know no real module: they are exercised
 * against these instead.
 *
 * - `manifest` (id `fixture`): people, companies, opportunities, notes and chores, with views, layouts and nav items.
 * - `paymentsManifest` and `mailerManifest`: modules that connect to an outside service, with an API key connection, actions and
 *   events, for the module-runtime paths.
 */
export {
  type Chore,
  type Company,
  chore,
  company,
  INDUSTRIES,
  ids,
  manifest,
  type Note,
  note,
  OPPORTUNITY_STAGES,
  type Opportunity,
  opportunity,
  type Person,
  person,
} from './contacts';
export { MAILER_EVENTS, mailerManifest } from './mailer';
export { PAYMENT_EVENTS, paymentsManifest } from './payments';
