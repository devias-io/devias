import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../src/testing';
import { ViewHost } from '../src/views/view-host';
import { useViewStateStore } from '../src/views/view-state';

beforeAll(installLayoutStubs);
afterEach(() => {
  cleanup();
  useViewStateStore.setState({ overrides: {} });
});

/** The company object with a `logo` link field, set as a picture or not. */
const withLogo = (image: boolean) => {
  const schema = schemaFixture();
  const name = schema.fields.find(
    (field) => field.objectId === '01a1751f-5f09-7114-9d75-c6298b7cb4b3' && field.name === 'name',
  );

  if (!name) {
    throw new Error('the fixture has no company name');
  }

  schema.fields.push({
    ...name,
    id: '01a17522-1eb8-7612-9ae6-7a759a7a8091',
    name: 'logo',
    label: 'Logo',
    type: 'url',
    settings: image ? { image: true } : {},
    position: 1,
  });
  const records = recordsFixture();
  const [acme] = records.company ?? [];

  if (!acme) {
    throw new Error('the fixture has no company');
  }

  records.company = [
    { ...acme, logo: 'acme.test/logo.png' },
    { ...acme, id: 'c2', name: 'Plain', logo: null },
  ];

  return { schema, records };
};

const showCompanies = (image: boolean) => {
  const { schema, records } = withLogo(image);
  const object = schema.objects.find((o) => o.nameSingular === 'company');

  if (!object) {
    throw new Error('the fixture has no company object');
  }

  return render(
    <TestProviders client={createFakeClient(schema, records)} schema={schema}>
      <div style={{ height: 600 }}>
        <ViewHost object={object} />
      </div>
    </TestProviders>,
  );
};

const cell = (container: HTMLElement, field: string, row: number) =>
  container.querySelectorAll<HTMLElement>(`[data-field="${field}"]`)[row] as HTMLElement;

describe("a record's picture in the table", () => {
  it("goes beside the name, with the object's icon standing in for a record without one", async () => {
    const { container } = showCompanies(true);
    await screen.findByRole('link', { name: 'Acme' });
    await waitFor(() => expect(container.querySelectorAll('[data-slot="record-image"]').length).toBeGreaterThan(0));
    // Both rows have the tile in their name cell, so the names line up.
    expect(cell(container, 'name', 0).querySelector('[data-slot="record-image"]')).toBeTruthy();
    expect(cell(container, 'name', 1).querySelector('[data-slot="record-image"]')).toBeTruthy();
    expect(cell(container, 'name', 0).querySelector('a')?.textContent).toBe('Acme');
  });

  it('is what the picture field itself shows in its column, and a blank where there is none', async () => {
    const { container } = showCompanies(true);
    await screen.findByRole('link', { name: 'Acme' });
    const withLink = cell(container, 'logo', 0);
    expect(withLink.querySelector('[data-slot="record-image"]')).toBeTruthy();
    // The address is not repeated as text.
    expect(screen.queryByRole('link', { name: 'acme.test/logo.png' })).toBeNull();
    expect(cell(container, 'logo', 1).querySelector('[data-slot="record-image"]')).toBeNull();
  });

  it('is not drawn for a link field that is not set as a picture', async () => {
    const { container } = showCompanies(false);
    await screen.findByRole('link', { name: 'Acme' });
    expect(container.querySelector('[data-slot="record-image"]')).toBeNull();
    expect(screen.getByRole('link', { name: 'acme.test/logo.png' }).getAttribute('href')).toBe(
      'https://acme.test/logo.png',
    );
  });
});

describe('an object with no picture field', () => {
  it('keeps its names plain', async () => {
    const schema = schemaFixture();
    const object = schema.objects.find((o) => o.nameSingular === 'person');

    if (!object) {
      throw new Error('the fixture has no person object');
    }

    const { container } = render(
      <TestProviders client={createFakeClient(schema, recordsFixture())} schema={schema}>
        <div style={{ height: 600 }}>
          <ViewHost object={object} />
        </div>
      </TestProviders>,
    );
    await screen.findByRole('link', { name: 'Ada' });
    expect(container.querySelector('[data-slot="record-image"]')).toBeNull();
  });
});
