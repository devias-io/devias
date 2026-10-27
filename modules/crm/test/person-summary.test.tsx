import { createMockClient } from '@devias/sdk/mock';
import { TestProviders } from '@devias/studio/testing';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { localTime, personSummaryBlock } from '../src/studio/blocks/person-summary';

afterEach(cleanup);

describe('person summary', () => {
  const show = async (data: Record<string, unknown>) => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [manifest] });
    const schema = await client.metadata.getSchema();
    const object = schema.objects.find((candidate) => candidate.nameSingular === 'person');

    if (!object) {
      throw new Error('the CRM is installed');
    }

    const person = await client.records.create('person', { first_name: 'Ana', last_name: 'Pop', ...data });
    const Summary = personSummaryBlock.component;
    render(
      <TestProviders client={client} schema={schema}>
        <Summary config={{}} surface="record" record={person} object={object} />
      </TestProviders>,
    );
  };

  it('links their profiles and sites, in order, over https unless the address says otherwise', async () => {
    await show({ linkedin: 'linkedin.com/in/ana', github: 'http://github.com/ana', website: 'ana.dev' });
    const links = [...document.querySelectorAll('[data-slot="person-link"]')];
    expect(links.map((link) => link.textContent?.trim())).toEqual(['LinkedIn', 'GitHub', 'Website']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://linkedin.com/in/ana',
      'http://github.com/ana',
      'https://ana.dev',
    ]);
  });

  it('shows where they are and their local time, and nothing for a zone nobody knows', async () => {
    await show({ city: 'Bucharest', country: 'Romania', time_zone: 'Europe/Bucharest' });
    expect(await screen.findByText(/Bucharest, Romania/)).toBeTruthy();
    expect(document.querySelector('[data-slot="local-time"]')).toBeTruthy();

    cleanup();
    await show({ time_zone: 'Mars/Olympus' });
    await screen.findByText('Ana Pop');
    expect(document.querySelector('[data-slot="local-time"]')).toBeNull();
    expect(document.querySelector('[data-slot="person-links"]')).toBeNull();
  });
});

describe('local time', () => {
  const noon = new Date('2026-10-14T12:00:00Z');

  it('reads the time in the zone, and how far it is from the viewer', () => {
    const mine = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(localTime(mine, noon)?.offset).toBe('same time as you');
    expect(localTime('Asia/Kolkata', noon)?.time).toMatch(/5:30|17:30/);
    expect(localTime('Not/AZone', noon)).toBeNull();
  });
});
