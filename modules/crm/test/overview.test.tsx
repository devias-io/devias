import type { RecordData } from '@devias/core';
import { localDate } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { TestProviders } from '@devias/studio/testing';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { overviewBlock } from '../src/studio/blocks/overview';
import { closeWords } from '../src/studio/shared';

afterEach(cleanup);

/** The local date `offset` calendar days from now (adding 24 hours is a day off across a clock change). */
const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  return localDate(date);
};

/** The layout of a `tabs` shape that a module declares, by name. */
const tabsLayout = (name: string) => {
  const layout = manifest.layouts.find((candidate) => candidate.label === name);

  return layout?.shell === 'tabs' ? layout : undefined;
};

describe('overview words', () => {
  it('says when a deal closes, from today', () => {
    const today = '2026-10-12';
    expect(closeWords('2026-10-22', today)).toBe('Closes in 10 days');
    expect(closeWords('2026-10-10', today)).toBe('Was due to close 2 days ago');
  });
});

describe('overview block', () => {
  const setup = async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [manifest] });
    const schema = await client.metadata.getSchema();
    const object = (name: string) => {
      const found = schema.objects.find((candidate) => candidate.nameSingular === name);

      if (!found) {
        throw new Error('the CRM is installed');
      }

      return found;
    };
    const Overview = overviewBlock.component;
    const show = (record: RecordData, name: string) =>
      render(
        <TestProviders client={client} schema={schema}>
          <Overview config={{}} surface="record" record={record} object={object(name)} />
        </TestProviders>,
      );

    return { client, show };
  };

  it("lists a person's open deals, by close date", async () => {
    const { client, show } = await setup();
    const ana = await client.records.create('person', { first_name: 'Ana' });
    await client.records.create('deal', {
      name: 'Bathroom',
      stage: 'meeting',
      amount: 2000,
      point_of_contact: ana.id,
      close_date: day(10),
    });
    await client.records.create('deal', {
      name: 'Heat pump',
      stage: 'proposal',
      amount: 9800,
      point_of_contact: ana.id,
    });
    await client.records.create('deal', {
      name: 'Boiler service',
      stage: 'customer',
      amount: 650,
      point_of_contact: ana.id,
    });
    await client.records.create('deal', { name: 'Lost one', stage: 'lost', amount: 5000, point_of_contact: ana.id });
    show(ana, 'person');

    const deals = await screen.findByText('Bathroom');
    // Open deals by close date, with their stage; tasks are another module's card.
    const dealList = within(deals.closest('section') as HTMLElement);
    expect(
      dealList
        .getAllByRole('link')
        .filter((link) => link.textContent !== 'View all')
        .map((link) => link.textContent?.split(/Meeting|Proposal/)[0]),
    ).toEqual(['Bathroom', 'Heat pump']);
    // Each deal is a row of cells: the stage, when it closes and what it is worth.
    expect(dealList.getByText('Meeting')).toBeTruthy();
    expect(dealList.getByText('Closes in 10 days')).toBeTruthy();
  });

  it("shows a person's company, their colleagues and what happened lately", async () => {
    const { client, show } = await setup();
    const acme = await client.records.create('company', {
      name: 'Acme',
      industry: 'software',
      employees: 40,
      domain: 'https://www.acme.com/',
      description: 'Makes anvils',
    });
    const ana = await client.records.create('person', { first_name: 'Ana', company: acme.id });
    await client.records.create('person', { first_name: 'Bo', last_name: 'Ng', job_title: 'CTO', company: acme.id });
    show(ana, 'person');

    const company = within((await screen.findByText('Acme')).closest('section') as HTMLElement);
    expect(company.getByText('Software')).toBeTruthy();
    expect(company.getByText('40')).toBeTruthy();
    expect(company.getByText('Makes anvils')).toBeTruthy();
    expect(company.getByText('acme.com').closest('a')?.getAttribute('href')).toBe('https://www.acme.com/');
    // The company's name is the way to its page; the card has no separate "Open" link.
    expect(company.queryByRole('link', { name: 'Open' })).toBeNull();
    expect(company.getByRole('link', { name: 'Acme' }).getAttribute('href')).toMatch(/\/records\/company\//);

    // Everyone at the company but the person themselves.
    const colleagues = within((await screen.findByText('Bo Ng')).closest('section') as HTMLElement);
    expect(colleagues.getByText('CTO')).toBeTruthy();
    expect(colleagues.queryByText('Ana')).toBeNull();

    const activity = await screen.findByText(/created this person/);
    expect(activity.closest('[data-slot="recent-activity"]')).toBeTruthy();
  });

  it('leaves out the company and colleagues of a person without one', async () => {
    const { client, show } = await setup();
    const ana = await client.records.create('person', { first_name: 'Ana' });
    show(ana, 'person');
    expect(await screen.findByText('No open deals.')).toBeTruthy();
    expect(screen.queryByText('Company')).toBeNull();
    expect(screen.queryByText('Colleagues')).toBeNull();
    expect(screen.getByText('Recent activity')).toBeTruthy();
  });

  it("shows a company's people, what happened lately and its open deals", async () => {
    const { client, show } = await setup();
    const acme = await client.records.create('company', { name: 'Acme' });
    await client.records.create('person', { first_name: 'Bo', last_name: 'Ng', job_title: 'CTO', company: acme.id });
    await client.records.create('deal', { name: 'Boiler', stage: 'screening', amount: 500, company: acme.id });
    await client.records.create('deal', { name: 'Won one', stage: 'customer', amount: 900, company: acme.id });
    show(acme, 'company');

    const people = within((await screen.findByText('Bo Ng')).closest('section') as HTMLElement);
    expect(people.getByText('CTO')).toBeTruthy();
    // Only what is still open, and no pipeline figures: the page is about the company.
    const deals = within((await screen.findByText('Boiler')).closest('section') as HTMLElement);
    expect(deals.queryByText('Won one')).toBeNull();
    expect(document.querySelector('[data-slot="signal-card"]')).toBeNull();
    expect((await screen.findByText(/created this company/)).closest('[data-slot="recent-activity"]')).toBeTruthy();
  });

  it("summarises a company's pipeline by stage, what it has won, and the deal that closes first", async () => {
    const { client, show } = await setup();
    const acme = await client.records.create('company', { name: 'Acme' });
    await client.records.create('deal', { name: 'Pilot', stage: 'screening', amount: 500, company: acme.id });
    await client.records.create('deal', {
      name: 'Boiler',
      stage: 'proposal',
      amount: 1500,
      company: acme.id,
      close_date: day(5),
    });
    await client.records.create('deal', {
      name: 'Heat pump',
      stage: 'proposal',
      amount: 2500,
      company: acme.id,
      close_date: day(20),
    });
    await client.records.create('deal', { name: 'Won one', stage: 'customer', amount: 900, company: acme.id });
    await client.records.create('deal', { name: 'Gone', stage: 'lost', amount: 7000, company: acme.id });
    show(acme, 'company');

    const pipeline = within(await screen.findByText((_, node) => node?.getAttribute('data-slot') === 'pipeline'));
    const figure = (stage: string) => (document.querySelector(`[data-stage="${stage}"]`) as HTMLElement).textContent;
    // Open stages with what each holds (sums come from the database); lost deals are not part of it.
    expect(figure('screening')).toBe('Screening€5001 deal');
    expect(figure('proposal')).toBe('Proposal€4,0002 deals');
    expect(document.querySelector('[data-stage="meeting"]')).toBeNull();
    expect(figure('won')).toBe('Won to date€9001 deal');
    expect(pipeline.getByRole('img').getAttribute('aria-label')).toBe(
      'Open pipeline €4,500: Screening €500, Proposal €4,000',
    );
    // The deal that closes first, and a way to it.
    const next = document.querySelector('[data-slot="next-deal"]') as HTMLElement;
    expect(next.textContent).toContain('Next: Boiler closes in 5 days, still at Proposal.');
    expect(within(next).getByRole('link', { name: 'Open deal' })).toBeTruthy();
  });

  it('leaves the pipeline out of a company without deals', async () => {
    const { client, show } = await setup();
    const acme = await client.records.create('company', { name: 'Acme' });
    show(acme, 'company');
    expect(await screen.findByText('No open deals.')).toBeTruthy();
    expect(document.querySelector('[data-slot="pipeline"]')).toBeNull();
  });

  it("lists a company's people as rows: the role under the name, the address on the right", async () => {
    const { client, show } = await setup();
    const acme = await client.records.create('company', { name: 'Acme' });
    await client.records.create('person', {
      first_name: 'Bo',
      last_name: 'Ng',
      job_title: 'CTO',
      email: 'bo@acme.com',
      company: acme.id,
    });
    await client.records.create('person', { first_name: 'Cy', company: acme.id });
    show(acme, 'company');
    const bo = (await screen.findByText('Bo Ng')).closest('li') as HTMLElement;
    expect(within(bo).getByRole('link').getAttribute('href')).toMatch(/\/records\/person\//);
    expect(within(bo).getByText('CTO')).toBeTruthy();
    expect(within(bo).getByText('bo@acme.com')).toBeTruthy();
    // A person without an address has nothing on the right.
    expect((screen.getByText('Cy').closest('li') as HTMLElement).textContent).toBe('CCy');
  });

  it('links to the whole list without counting it, and draws no side for a company', async () => {
    const { client, show } = await setup();
    const acme = await client.records.create('company', { name: 'Acme' });
    await client.records.create('person', { first_name: 'Bo', company: acme.id });
    await client.records.create('deal', { name: 'Boiler', stage: 'screening', amount: 500, company: acme.id });
    show(acme, 'company');
    await screen.findByText('Bo');
    // Links, not buttons, and "View all" rather than "View all 1": the number is in the tab, not in the link.
    const all = screen.getAllByRole('link', { name: 'View all' });
    expect(all.length).toBeGreaterThan(1);
    expect(
      all.every((link) =>
        /\/records\/company\/[^/]+\?tab=(people|deals|activity)$/.test(link.getAttribute('href') ?? ''),
      ),
    ).toBe(true);
    expect(screen.queryByRole('link', { name: /View all \d/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /View/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'View deals' }).getAttribute('href')).toMatch(/\?tab=deals$/);

    cleanup();
    // The company's details are fields blocks in the layout; the overview's own `side` part is empty.
    const Overview = overviewBlock.component;
    const schema = await client.metadata.getSchema();
    const object = schema.objects.find((candidate) => candidate.nameSingular === 'company');

    if (!object) {
      throw new Error('the CRM is installed');
    }

    const { container } = render(
      <TestProviders client={client} schema={schema}>
        <Overview config={{ part: 'side' }} surface="record" record={acme} object={object} />
      </TestProviders>,
    );
    expect(container.querySelector('[data-slot="pipeline"]')).toBeNull();
    expect(container.textContent).not.toContain('Open deals');
  });

  it('opens person and company pages on Overview, before Activity', () => {
    for (const name of ['Person', 'Company']) {
      const tabs = tabsLayout(name)?.tabs.map((tab) => tab.name);
      expect(tabs?.[0]).toBe('overview');
      expect(tabs?.indexOf('overview')).toBeLessThan(tabs?.indexOf('activity') ?? -1);
    }
  });

  it("puts a company's details in the narrow column of its overview, as a person's are, and not beside it", () => {
    const layout = tabsLayout('Company');
    const overview = layout?.tabs.find((tab) => tab.name === 'overview');
    const main = overview?.blocks.find((cell) => cell.name === 'overview');
    expect(main?.config).toEqual({ part: 'main' });
    expect(main?.columnSpan).toBe(8);
    const side = (overview?.blocks ?? []).filter((cell) => cell.column === 9);
    expect(side.map((cell) => cell.label)).toEqual(['Contact', 'Profile', 'Record']);
    // Every field of the company is in one of the groups, once.
    const listed = side.flatMap((cell) =>
      (cell.config as { fieldIds: string[] }).fieldIds.map((id) => id.split('.').pop() as string),
    );
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed).toEqual(
      expect.arrayContaining(['name', 'logo', 'domain', 'industry', 'employees', 'annual_revenue', 'owner', 'source']),
    );
    // The header is the layout's own, so there is no Details tab to repeat them; comments have a tab of their own.
    expect(layout?.header?.name).toBe('company_summary');
    expect(layout?.tabs.map((tab) => tab.name)).toEqual(['overview', 'comments', 'activity', 'people', 'deals']);
  });

  it('reads a deal as one page, not tabs: its stage, then the conversation, with its terms beside', () => {
    const layout = manifest.layouts.find((candidate) => candidate.label === 'Deal');
    expect(layout?.shell).toBe('split');
    const main = layout?.shell === 'split' ? layout.main.map((cell) => cell.blockId) : [];
    expect(main).toEqual(['core.title', 'crm.deal_stage', 'core.comments', 'core.activity']);
    const aside = layout?.shell === 'split' ? layout.aside : [];
    const listed = aside.flatMap((cell) =>
      (cell.config as { fieldIds: string[] }).fieldIds.map((id) => id.split('.').pop() as string),
    );
    // Every field the page does not show elsewhere is in one of the groups, once: the name is the title and the stage is
    // the stepper.
    expect(new Set(listed).size).toBe(listed.length);
    expect(listed.sort()).toEqual(
      [
        'amount',
        'close_date',
        'company',
        'lost_reason',
        'owner',
        'point_of_contact',
        'probability',
        'rating',
        'source',
      ].sort(),
    );
  });
});
