import { defineField, defineModule, defineObject, defineView } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useOpenCreateRecord } from '../src/providers/create-record';
import { createStaticNavigation } from '../src/router/navigation';
import { TestProviders } from '../src/testing';

afterEach(cleanup);

const thing = (name: string) =>
  defineObject({
    id: `lab.${name}`,
    nameSingular: name,
    namePlural: `${name}s`,
    labelSingular: name,
    labelPlural: `${name}s`,
    primaryField: `lab.${name}.title`,
    fields: [
      defineField({
        id: `lab.${name}.title`,
        name: 'title',
        label: 'Title',
        type: 'text',
        isRequired: true,
      }),
    ],
  });
const lab = defineModule({
  id: 'lab',
  version: '0.1.0',
  objects: [thing('quick'), thing('slow')],
  views: [
    defineView({
      id: 'lab.quick.quick',
      objectId: 'lab.quick',
      label: 'All',
      isDefault: true,
      settings: { quickCreate: true },
    }),
    defineView({ id: 'lab.slow.slow', objectId: 'lab.slow', label: 'All', isDefault: true }),
  ],
});

function Opener({ object }: { object: string }) {
  const open = useOpenCreateRecord();

  return (
    <button type="button" onClick={() => open({ object })}>
      new
    </button>
  );
}

describe('creating a record from anywhere', () => {
  const setup = async (object: string) => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [lab] });
    const schema = await client.metadata.getSchema();
    const navigation = createStaticNavigation('/workspaces/acme/records/quick');
    window.history.replaceState(null, '', '/');
    const view = render(
      <TestProviders client={client} schema={schema} navigation={navigation}>
        <Opener object={object} />
      </TestProviders>,
    );

    return { client, button: view.getByRole('button', { name: 'new' }), view };
  };

  it('makes an untitled record and opens it, with no dialog, when the default view says quickCreate', async () => {
    const { client, button, view } = await setup('quick');
    button.click();
    await waitFor(async () => expect((await client.records.list({ object: 'quick' })).items).toHaveLength(1));
    const [record] = (await client.records.list({ object: 'quick' })).items;
    expect(record).toMatchObject({ title: 'Untitled' });
    await waitFor(() => expect(window.location.pathname).toContain(String(record?.id)));
    expect(view.queryByRole('dialog')).toBeNull();
  });

  it('still opens the dialog for an object that does not ask for it', async () => {
    const { client, button, view } = await setup('slow');
    button.click();
    expect(await view.findByRole('dialog')).toBeTruthy();
    expect((await client.records.list({ object: 'slow' })).items).toHaveLength(0);
  });
});
