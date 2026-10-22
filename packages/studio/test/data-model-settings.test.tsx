import { createMockClient } from '@devias/sdk/mock';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { dataModelSection } from '../src/pages/settings/sections/data-model';
import { TestProviders } from '../src/testing';

afterEach(cleanup);

describe('the data model settings', () => {
  it('gives a new object its row in the sidebar, after the others', async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
    const schema = await client.metadata.getSchema();
    const before = await client.metadata.navItems.list();
    const Section = dataModelSection.component;
    render(
      <TestProviders client={client} schema={schema}>
        <Section />
      </TestProviders>,
    );
    fireEvent.click(await screen.findByRole('button', { name: /New object/ }));
    fireEvent.change(await screen.findByLabelText('Label (singular)'), { target: { value: 'Widget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));

    await waitFor(async () => expect((await client.metadata.navItems.list()).length).toBe(before.length + 1));
    const object = (await client.metadata.objects.list()).find((one) => one.nameSingular === 'widget');
    const row = (await client.metadata.navItems.list()).find((item) => item.label === 'Widgets');
    expect(row?.target).toEqual({ kind: 'object', objectId: object?.id });
    expect(row?.parentId).toBeNull();
    expect(row?.position).toBe(Math.max(-1, ...before.filter((n) => n.parentId === null).map((n) => n.position)) + 1);
  });
});
