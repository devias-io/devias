import { localDate } from '@devias/core';
import { manifest as crm } from '@devias/mod-crm/manifest';
import { createMockClient } from '@devias/sdk/mock';
import { installLayoutStubs, TestProviders } from '@devias/studio/testing';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { billingPages } from '../src/studio/pages/billing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const day = (offset: number) => {
  const date = new Date();
  date.setDate(date.getDate() + offset);

  return localDate(date);
};
const eur = (value: number) => new Intl.NumberFormat(undefined, { style: 'currency', currency: 'EUR' }).format(value);

describe('Billing', () => {
  const setup = async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [crm, manifest] });
    const schema = await client.metadata.getSchema();
    const harbor = await client.records.create('company', {
      name: 'Harbor Finance',
      logo: 'https://harbor.example/logo.svg',
    });
    const sent = (number: string, total: number, due: number | null) =>
      client.records.create('invoice', {
        number,
        company: harbor.id,
        status: 'sent',
        total,
        ...(due === null ? {} : { due_date: day(due) }),
      });
    await sent('INV-1', 1000, -12);
    await sent('INV-2', 500, -45);
    await sent('INV-3', 300, 9);
    const settled = await client.records.create('invoice', { number: 'INV-4', status: 'paid', total: 800 });
    await client.records.create('payment', { invoice: settled.id, amount: 800, paid_on: day(-5) });
    await client.records.create('payment', { invoice: settled.id, amount: 2000, paid_on: day(-60) });
    const Page = billingPages[0]?.component as ComponentType;
    render(
      <TestProviders client={client} schema={schema}>
        <Page />
      </TestProviders>,
    );
  };

  /** The figures of the row at the top, by label. */
  const figure = (label: string) =>
    [...document.querySelectorAll('[data-slot="figure"]')].find((element) => element.textContent?.startsWith(label))
      ?.textContent;

  it('leads with a row of figures: outstanding, overdue and collected in the last 30 days', async () => {
    await setup();
    await screen.findByText('INV-1');
    expect(figure('Outstanding')).toBe(`Outstanding${eur(1800)}3 invoices`);
    expect(figure('Overdue')).toBe(`Overdue${eur(1500)}2 invoices`);
    // The payment of 60 days ago is outside the last 30 days; the sums come from the database.
    await waitFor(() => expect(figure('Collected, last 30 days')).toBe(`Collected, last 30 days${eur(800)}1 payment`));
  });

  it('charts what came in month by month and splits what is open by how late it is, in two white cards', async () => {
    await setup();
    await screen.findByText('INV-1');
    // Both payments fall inside the six months the chart shows.
    expect(await screen.findByLabelText(`Money in by month, last 6 months: ${eur(2800)}`)).toBeTruthy();
    // The chart already names the month under the figure it reads out, so the figure is the amount alone.
    const chart = screen.getByLabelText(/Money in by month/).closest('[data-slot="insight-card"]') as HTMLElement;
    const month = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date());
    expect(chart.textContent).not.toContain(`${month} ·`);
    const age = document.querySelector('[data-slot="age"]') as HTMLElement;
    const bucket = (position: number) => age.querySelector(`[data-bucket="${position}"] dd`)?.textContent;
    // Not yet due, then 1-30 days late (INV-1), 31-60 (INV-2), and nothing older.
    expect([0, 1, 2, 3, 4].map(bucket)).toEqual([eur(300), eur(1000), eur(500), eur(0), eur(0)]);
    expect(within(age).getByRole('img').getAttribute('aria-label')).toContain(`${eur(1800)}`);
    // What is analysed sits in two white cards with a hairline; the invoices below them are not in cards at all.
    const cards = [...document.querySelectorAll('[data-slot="insight-card"]')];
    expect(cards).toHaveLength(2);
    expect(cards.every((card) => card.className.includes('ring-card-border'))).toBe(true);
    expect(document.querySelector('[data-slot="invoice-rows"]')?.closest('[data-slot="insight-card"]')).toBeNull();
  });

  it('lists the overdue, open and paid invoices as plain tables of links, with a plain "View all"', async () => {
    await setup();
    const overdue = within((await screen.findByText('INV-1')).closest('[data-slot="invoice-rows"]') as HTMLElement);
    // Longest overdue first, each a link to the invoice.
    expect(overdue.getAllByRole('link').map((link) => link.textContent?.slice(0, 5))).toEqual(['INV-2', 'INV-1']);
    expect(overdue.getByText('Invoice')).toBeTruthy();
    expect(overdue.getByText('45 days overdue')).toBeTruthy();
    expect(overdue.getByText('12 days overdue').className).toContain('text-destructive');
    expect(overdue.getAllByRole('link')[0]?.getAttribute('href')).toMatch(/\/records\/invoice\//);
    const open = within(screen.getByText('INV-3').closest('[data-slot="invoice-rows"]') as HTMLElement);
    expect(open.getByText('Due in 9 days')).toBeTruthy();
    expect(await open.findByText('Harbor Finance')).toBeTruthy();
    const paid = within(screen.getByText('INV-4').closest('[data-slot="invoice-rows"]') as HTMLElement);
    expect(paid.getByText(/^Paid /)).toBeTruthy();
    // Each section's heading row links to every invoice; no count, and a link, not a button.
    const all = screen.getAllByRole('link', { name: 'View all' });
    expect(all).toHaveLength(3);
    expect(all.every((link) => /\/records\/invoice$/.test(link.getAttribute('href') ?? ''))).toBe(true);
    expect(screen.queryByRole('button', { name: /View all/ })).toBeNull();
  });

  it('shows the customer beside its logo, or the company icon until there is one', async () => {
    await setup();
    const open = within((await screen.findByText('INV-3')).closest('[data-slot="invoice-rows"]') as HTMLElement);
    const customer = (await open.findByText('Harbor Finance')).parentElement as HTMLElement;
    expect(customer.querySelector('[data-slot="record-image"]')).toBeTruthy();
  });

  it('is centered on the page like Home, as wide as it is', async () => {
    await setup();
    await screen.findByText('INV-1');
    const page = document.querySelector('[data-slot="page"]') as HTMLElement;
    expect(page.className).toContain('mx-auto');
    expect(page.className).toContain('max-w-[90rem]');
  });
});
