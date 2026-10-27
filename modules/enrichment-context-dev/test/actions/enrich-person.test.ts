import { RetryableError } from '@devias/server';
import { describe, expect, it } from 'vitest';
import { ids } from '../../src/manifest/ids';
import { enrichPerson } from '../../src/server/actions/enrich-person';
import { contextWith, fakeFetch } from '../helpers';

const found = (score: number, person: Record<string, unknown> = {}) => ({
  body: {
    match: {
      status: 'candidate',
      score,
      person: {
        location: { city: 'Cluj-Napoca', country: 'Romania' },
        social_urls: [
          'https://www.linkedin.com/in/ada',
          'https://x.com/ada',
          'https://github.com/ada',
          'https://example.com/ada',
        ],
        website_urls: ['https://ada.example'],
        current_role: { title: 'CTO', organization: { name: 'Acme', domain: 'Acme.com' }, is_current: true },
        current_role_status: 'present',
        ...person,
      },
    },
  },
});
const ada = { id: 'p1', first_name: 'Ada', last_name: 'Lovelace', email: 'ada@acme.com' };
const run = (
  ctx: ReturnType<typeof contextWith>,
  input: { person_id: string; force?: boolean } = { person_id: 'p1' },
) => enrichPerson.run(enrichPerson.input.parse(input), ctx);

describe('enrichPerson', () => {
  it('looks the person up by email, name and company, and fills in only what is empty', async () => {
    const fetch = fakeFetch(() => found(88));
    const rows = {
      person: [{ ...ada, job_title: 'Founder', company: 'c1' }],
      company: [{ id: 'c1', name: 'Acme', domain: 'acme.com' }],
    };
    const ctx = contextWith({ api_key: 'ctx_key' }, fetch, { rows });
    const result = await run(ctx);

    expect(result).toEqual({
      enriched: true,
      score: 88,
      fields: ['city', 'country', 'linkedin', 'twitter', 'github', 'website'],
    });
    const [url, init] = fetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.context.dev/v1/people/enrich');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer ctx_key');
    expect(JSON.parse(String(init.body))).toEqual({
      email: 'ada@acme.com',
      name: { first: 'Ada', last: 'Lovelace' },
      company: { domain: 'acme.com' },
    });
    // The job title the CRM had is kept.
    expect(ctx.records.update).toHaveBeenCalledWith('person', 'p1', {
      city: 'Cluj-Napoca',
      country: 'Romania',
      linkedin: 'https://www.linkedin.com/in/ada',
      twitter: 'https://x.com/ada',
      github: 'https://github.com/ada',
      website: 'https://ada.example',
    });
  });

  it('fills in the job title, and links the company when it is in the CRM', async () => {
    const rows = { person: [{ ...ada }], company: [{ id: 'c9', name: 'Acme', domain: 'acme.com' }] };
    const ctx = contextWith(
      { api_key: 'k' },
      fakeFetch(() => found(90)),
      { rows },
    );
    const result = (await run(ctx)) as { fields: string[] };
    expect(result.fields).toContain('job_title');
    expect(result.fields).toContain('company');
    expect(rows.person[0]).toMatchObject({ job_title: 'CTO', company: 'c9' });
  });

  it('does not write down a job the person no longer holds', async () => {
    const ended = { current_role_status: 'none', current_role: { title: 'CTO', is_current: false } };
    const ctx = contextWith(
      { api_key: 'k' },
      fakeFetch(() => found(90, ended)),
      { rows: { person: [{ ...ada }] } },
    );
    expect(((await run(ctx)) as { fields: string[] }).fields).not.toContain('job_title');
  });

  it('leaves the person alone when the match is weaker than the workspace asks', async () => {
    const rows = { person: [{ ...ada }] };
    const weak = contextWith(
      { api_key: 'k' },
      fakeFetch(() => found(60)),
      { rows },
    );
    expect(await run(weak)).toEqual({
      enriched: false,
      reason: 'The match is too weak (score 60, 70 needed)',
      score: 60,
    });
    expect(weak.records.update).not.toHaveBeenCalled();
    // The workspace can lower the bar.
    const lenient = contextWith(
      { api_key: 'k' },
      fakeFetch(() => found(60)),
      {
        rows,
        variables: { [ids.variables.min_match_score]: '50' },
      },
    );
    expect(await run(lenient)).toMatchObject({ enriched: true });
  });

  it('says so when no one is found', async () => {
    const ctx = contextWith(
      { api_key: 'k' },
      fakeFetch(() => ({ body: { match: { status: 'not_found', score: null, person: null } } })),
      {
        rows: { person: [{ ...ada }] },
      },
    );
    expect(await run(ctx)).toEqual({ enriched: false, reason: 'Context.dev found no one' });
    expect(ctx.records.update).not.toHaveBeenCalled();
  });

  it('does not ask without an email, or both names and a company', async () => {
    const fetch = fakeFetch(() => found(90));
    const ctx = contextWith({ api_key: 'k' }, fetch, {
      rows: { person: [{ id: 'p1', first_name: 'Ada', last_name: 'Lovelace' }] },
    });
    expect(await run(ctx)).toEqual({
      enriched: false,
      reason: "Not enough to go on. Add the person's email, or a company or a city.",
    });
    expect(fetch).not.toHaveBeenCalled();

    // A first name alone, even with a company, is not enough: Context.dev wants both names without an email.
    const firstOnly = contextWith({ api_key: 'k' }, fetch, {
      rows: {
        person: [{ id: 'p1', first_name: 'Ada', company: 'c1' }],
        company: [{ id: 'c1', name: 'Acme', domain: 'acme.com' }],
      },
    });
    expect(await run(firstOnly)).toEqual({
      enriched: false,
      reason: "Not enough to go on. Add the person's email, or a last name.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('goes on the name and the place when the person has no company', async () => {
    const fetch = fakeFetch(() => found(90));
    const ctx = contextWith({ api_key: 'k' }, fetch, {
      rows: {
        person: [{ id: 'p1', first_name: 'Ada', last_name: 'Lovelace', city: 'London', country: 'United Kingdom' }],
      },
    });
    expect(await run(ctx)).toMatchObject({ enriched: true });
    expect(JSON.parse(String((fetch.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({
      name: { first: 'Ada', last: 'Lovelace' },
      location: { city: 'London', country: 'United Kingdom' },
    });
  });

  it('asks again on the name and the company when the email is a free or throwaway address', async () => {
    const answers = [{ status: 422, body: { error: 'FREE_EMAIL_DETECTED' } }, found(85)];
    const fetch = fakeFetch(() => answers.shift() ?? { status: 500 });
    const rows = {
      person: [{ ...ada, email: 'ada@gmail.com', company: 'c1' }],
      company: [{ id: 'c1', name: 'Acme', domain: 'acme.com' }],
    };
    const ctx = contextWith({ api_key: 'k' }, fetch, { rows });
    expect(await run(ctx)).toMatchObject({ enriched: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String((fetch.mock.calls[1] as [string, RequestInit])[1].body))).toEqual({
      name: { first: 'Ada', last: 'Lovelace' },
      company: { domain: 'acme.com' },
    });
  });

  it('does not look the same person up twice in a row, unless asked to', async () => {
    const fetch = fakeFetch(() => found(90));
    const ctx = contextWith({ api_key: 'k' }, fetch, { rows: { person: [{ ...ada }] } });
    await run(ctx);
    expect(await run(ctx)).toEqual({ enriched: false, reason: 'Looked up recently' });
    expect(fetch).toHaveBeenCalledTimes(1);
    await run(ctx, { person_id: 'p1', force: true });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('asks for a retry when the service is busy, and for a new key when it refuses the key', async () => {
    const busy = contextWith(
      { api_key: 'k' },
      fakeFetch(() => ({ status: 429, headers: { 'retry-after': '12' }, body: { message: 'Slow down' } })),
      { rows: { person: [{ ...ada }] } },
    );
    await expect(run(busy)).rejects.toMatchObject({ name: 'RetryableError', retryAfterMs: 12_000 });
    await expect(run(busy)).rejects.toBeInstanceOf(RetryableError);

    const refused = contextWith(
      { api_key: 'bad' },
      fakeFetch(() => ({ status: 401, body: { message: 'Bad key' } })),
      {
        rows: { person: [{ ...ada }] },
      },
    );
    await expect(run(refused)).rejects.toThrow('Context.dev answered 401: Bad key');
    expect(refused.reportAuthFailure).toHaveBeenCalledWith('Context.dev answered 401: Bad key');

    const broke = contextWith(
      { api_key: 'k' },
      fakeFetch(() => ({ status: 402, body: { message: 'No credits' } })),
      {
        rows: { person: [{ ...ada }] },
      },
    );
    await expect(run(broke)).rejects.toThrow('The account is out of credits');
  });
});
