import { createMockClient } from '@devias/sdk/mock';
import { TestProviders } from '@devias/studio/testing';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { companySummaryBlock } from '../src/studio/blocks/company-summary';

afterEach(cleanup);

describe('company summary', () => {
  const show = async (data: Record<string, unknown>) => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [manifest] });
    const schema = await client.metadata.getSchema();
    const object = schema.objects.find((candidate) => candidate.nameSingular === 'company');

    if (!object) {
      throw new Error('the CRM is installed');
    }

    const company = await client.records.create('company', { name: 'Acme', ...data });
    const Summary = companySummaryBlock.component;
    render(
      <TestProviders client={client} schema={schema}>
        <Summary config={{}} surface="record" record={company} object={object} />
      </TestProviders>,
    );
  };

  it('shows the name, the industry and where it is', async () => {
    await show({ industry: 'software', city: 'Cluj-Napoca', domain: 'acme.com' });
    expect(await screen.findByText('Acme')).toBeTruthy();
    expect(screen.getByText('Software')).toBeTruthy();
    expect(screen.getByText('Cluj-Napoca')).toBeTruthy();
  });

  it('links its profile and site over https unless the address says otherwise', async () => {
    await show({ linkedin: 'linkedin.com/company/acme', domain: 'http://acme.com' });
    const links = [...document.querySelectorAll('[data-slot="company-links"] a')];
    expect(links.map((link) => link.getAttribute('aria-label'))).toEqual(['LinkedIn', 'Website']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      'https://linkedin.com/company/acme',
      'http://acme.com',
    ]);
  });

  it('draws a building until the company has a logo, and none of the links it lacks', async () => {
    await show({});
    await screen.findByText('Acme');
    expect(document.querySelector('[data-slot="company-logo"] svg')).toBeTruthy();
    expect(document.querySelector('[data-slot="company-links"]')).toBeNull();
  });
});
