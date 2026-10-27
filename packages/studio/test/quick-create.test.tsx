import { defineField, defineModule, defineObject, defineView } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useOpenCreateRecord } from '../src/providers/create-record';
import { createStaticNavigation } from '../src/router/navigation';
import { TestProviders } from '../src/testing';

afterEach(cleanup);

const thingIds: Record<string, { object: string; title: string }> = {
  quick: { object: '01a1751f-5f08-717d-a428-4dc1f382ed40', title: '01a17522-1ec2-7b10-9c41-1a1b2c3d4e61' },
  slow: { object: '01a1751f-5f08-717d-a428-572ba62f21b5', title: '01a17522-1ec2-7b10-9c41-1a1b2c3d4e62' },
};
const thing = (name: string) =>
  defineObject({
    id: thingIds[name]?.object as string,
    nameSingular: name,
    namePlural: `${name}s`,
    labelSingular: name,
    labelPlural: `${name}s`,
    primaryField: thingIds[name]?.title as string,
    fields: [
      defineField({
        id: thingIds[name]?.title as string,
        name: 'title',
        label: 'Title',
        type: 'text',
        isRequired: true,
      }),
    ],
  });
const lab = defineModule({
  id: '01a1751f-5f08-717d-a428-446a0ff330a8',
  version: '0.1.0',
  objects: [thing('quick'), thing('slow')],
  views: [
    defineView({
      id: '01a1751f-5f08-717d-a428-4ac062aac6b5',
      objectId: '01a1751f-5f08-717d-a428-4dc1f382ed40',
      label: 'All',
      isDefault: true,
      settings: { quickCreate: true },
    }),
    defineView({
      id: '01a1751f-5f08-717d-a428-5129b0c0ae12',
      objectId: '01a1751f-5f08-717d-a428-572ba62f21b5',
      label: 'All',
      isDefault: true,
    }),
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
