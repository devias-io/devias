import { defineField, defineModule, defineObject } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fieldsBlock } from '../src/record/blocks/fields';
import { TestProviders } from '../src/testing';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const contact = defineObject({
  id: 'lab.contact',
  nameSingular: 'contact',
  namePlural: 'contacts',
  labelSingular: 'Contact',
  labelPlural: 'Contacts',
  primaryField: 'lab.contact.name',
  fields: [
    defineField({ id: 'lab.contact.name', name: 'name', label: 'Name', type: 'text' }),
    defineField({ id: 'lab.contact.email', name: 'email', label: 'Email', type: 'email' }),
    defineField({ id: 'lab.contact.phone', name: 'phone', label: 'Phone', type: 'phone' }),
    defineField({ id: 'lab.contact.city', name: 'city', label: 'City', type: 'text' }),
  ],
});

const show = async (config: Record<string, unknown>) => {
  const client = createMockClient({
    workspaceId: 'ws1',
    manifests: [defineModule({ id: 'lab', version: '0.1.0', objects: [contact] })],
  });
  const schema = await client.metadata.getSchema();
  const object = schema.objects.find((candidate) => candidate.nameSingular === 'contact');

  if (!object) {
    throw new Error('the object is installed');
  }

  const record = await client.records.create('contact', { name: 'Ana Pop', email: 'ana@example.com' });
  const Fields = fieldsBlock.component;
  render(
    <TestProviders client={client} schema={schema}>
      <Fields config={config} surface="record" record={record} object={object} />
    </TestProviders>,
  );
  await screen.findByText('Name');
};

describe('fields block', () => {
  it('shows every field by default, empty ones too', async () => {
    await show({});
    expect(screen.getByText('Phone')).toBeTruthy();
    expect(screen.getByText('City')).toBeTruthy();
    expect(document.querySelector('[data-slot="empty-fields"]')).toBeNull();
  });

  it('keeps fields with no value behind one line that names them, and opens them on a click', async () => {
    await show({ collapseEmpty: true });
    expect(screen.queryByText('City')).toBeNull();
    expect(screen.getByText('Email')).toBeTruthy();
    const toggle = document.querySelector('[data-slot="empty-fields"]') as HTMLElement;
    expect(toggle.textContent).toContain('Add Phone, City');
    fireEvent.click(toggle);
    expect(screen.getByText('City')).toBeTruthy();
    expect(toggle.textContent).toContain('Hide empty fields');
  });

  it('copies an address with its button, and offers none for a plain text field', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await show({});
    fireEvent.click(screen.getByRole('button', { name: 'Copy Email' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('ana@example.com'));
    expect(screen.queryByRole('button', { name: 'Copy Name' })).toBeNull();
    vi.unstubAllGlobals();
  });
});
