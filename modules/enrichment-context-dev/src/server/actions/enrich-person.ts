import { type ActionContext, defineActionHandler } from '@devias/server';
import { z } from 'zod';
import { ids } from '../../manifest/ids';
import { auth, ProviderError, request } from '../http';
import { type EnrichResponse, employerDomainOf, fillableFields, isEmpty } from '../person';

const Input = z.object({ person_id: z.string().min(1), force: z.boolean().optional() });

/** A person looked up lately is not looked up again: a match costs 20 credits, and a repeat finds the same. */
const FOUND_DAYS = 30;
/** Someone Context.dev did not know today may be known tomorrow, but not every minute. */
const MISSING_DAYS = 1;
const DAY_MS = 86_400_000;
const DEFAULT_MIN_SCORE = 70;

const cacheKey = (personId: string) => `looked-up:${personId}`;

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

/** The lowest match score a workspace accepts, from its variable. */
const minScoreOf = (ctx: ActionContext): number => {
  const score = Number(ctx.variables[ids.variables.min_match_score]);

  return Number.isFinite(score) && score >= 0 && score <= 100 ? score : DEFAULT_MIN_SCORE;
};

interface Clues {
  email?: string;
  name?: { first: string; last: string };
  company?: { domain?: string; name?: string };
  location?: { city?: string; country?: string };
}

/** What Context.dev is asked about: the person's email, their name, and the company they are linked to. */
const cluesOf = async (ctx: ActionContext, person: Record<string, unknown>): Promise<Clues> => {
  const first = text(person.first_name);
  const last = text(person.last_name);
  const clues: Clues = {};
  const email = text(person.email);

  if (email) {
    clues.email = email;
  }

  if (first && last) {
    clues.name = { first, last };
  }

  const city = text(person.city);
  const country = text(person.country);

  if (city || country) {
    clues.location = { ...(city ? { city } : {}), ...(country ? { country } : {}) };
  }

  const companyId = text(person.company);

  if (companyId) {
    const company = await ctx.engine.records.get('company', companyId).catch(() => null);
    const domain = text(company?.domain);
    const name = text(company?.name);

    if (domain || name) {
      clues.company = { ...(domain ? { domain } : {}), ...(!domain && name ? { name } : {}) };
    }
  }

  return clues;
};

/** Is what is known enough for Context.dev to go on, without the email? It wants both names and a company or a place. */
const enoughWithoutEmail = (clues: Clues): boolean =>
  clues.name !== undefined && (clues.company !== undefined || clues.location !== undefined);

/** What a person lacks for Context.dev to look them up without an email, in words. */
const whatIsMissing = (person: Record<string, unknown>, clues: Clues): string => {
  const lacks: string[] = [];

  if (!text(person.first_name)) {
    lacks.push('a first name');
  }

  if (!text(person.last_name)) {
    lacks.push('a last name');
  }

  if (clues.company === undefined && clues.location === undefined) {
    lacks.push('a company or a city');
  }

  return `Not enough to go on. Add the person's email, or ${lacks.join(' and ')}.`;
};

/** What Context.dev is told when there is no email to go on: the name, and where the person works or lives. */
const withoutEmail = (clues: Clues) => ({
  name: clues.name,
  ...(clues.company ? { company: clues.company } : {}),
  ...(clues.location ? { location: clues.location } : {}),
});

const lookup = async (ctx: ActionContext, body: Record<string, unknown>): Promise<EnrichResponse> => {
  try {
    return await request<EnrichResponse>(ctx, '/v1/people/enrich', body, await auth(ctx));
  } catch (error) {
    if (error instanceof ProviderError && error.status === 422) {
      // A free or throwaway address says nothing about the person.
      return { match: { status: 'not_found' } };
    }

    throw error;
  }
};

/** Look a CRM person up on Context.dev and fill in what is empty. Safe to run again: it fills only what is empty. */
export const enrichPerson = defineActionHandler({
  id: ids.actions.enrich_person,
  input: Input,
  run: async ({ person_id, force }, ctx) => {
    const person = await ctx.engine.records.get('person', person_id);

    if (!force && (await ctx.kv.get(cacheKey(person_id)))) {
      return { enriched: false, reason: 'Looked up recently' };
    }

    const clues = await cluesOf(ctx, person);

    if (clues.email === undefined && !enoughWithoutEmail(clues)) {
      return { enriched: false, reason: whatIsMissing(person, clues) };
    }

    let response = await lookup(
      ctx,
      clues.email
        ? {
            email: clues.email,
            ...(clues.name ? { name: clues.name } : {}),
            ...(clues.company ? { company: clues.company } : {}),
          }
        : withoutEmail(clues),
    );

    // A free or throwaway email is refused: try again on the name and the company, if there are both.
    if (clues.email && response.match?.status === 'not_found' && enoughWithoutEmail(clues)) {
      response = await lookup(ctx, withoutEmail(clues));
    }

    const found = response.match?.person;
    const score = response.match?.score ?? null;

    if (response.match?.status !== 'candidate' || !found) {
      await ctx.kv.set(cacheKey(person_id), true, { ttlMs: MISSING_DAYS * DAY_MS });

      return { enriched: false, reason: 'Context.dev found no one' };
    }

    // A match that has been paid for is kept, whatever is done with it.
    await ctx.kv.set(cacheKey(person_id), true, { ttlMs: FOUND_DAYS * DAY_MS });

    if (score === null || score < minScoreOf(ctx)) {
      return {
        enriched: false,
        reason: `The match is too weak (score ${score ?? 'unknown'}, ${minScoreOf(ctx)} needed)`,
        ...(score === null ? {} : { score }),
      };
    }

    const fill: Record<string, unknown> = fillableFields(found, person);

    // The company the person works at, when it is already in the CRM.
    const domain = employerDomainOf(found);

    if (domain && isEmpty(person.company)) {
      const companies = await ctx.engine.records.list({
        object: 'company',
        filter: { and: [{ field: 'domain', op: 'eq', value: domain }] },
        limit: 1,
      });
      const company = companies.items[0];

      if (company) {
        fill.company = company.id;
      }
    }

    if (Object.keys(fill).length === 0) {
      return { enriched: false, reason: 'Nothing new to fill in', score };
    }

    await ctx.engine.records.update('person', person_id, fill);

    return { enriched: true, score, fields: Object.keys(fill) };
  },
});
