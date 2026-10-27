import { defineField, defineModule, defineObject } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { mentionedInBlock } from '../src/record/blocks/mentioned-in';
import { TestProviders } from '../src/testing';

afterEach(cleanup);

const labIds: Record<string, string> = {
  'lab.page': '01a17522-1ec2-7b10-9c41-0a1b2c3d4e51',
  'lab.page.title': '01a17522-1ec2-7b10-9c41-0a1b2c3d4e52',
  'lab.page.body': '01a17522-1ec2-7b10-9c41-0a1b2c3d4e53',
  'lab.chore': '01a17522-1ec2-7b10-9c41-0a1b2c3d4e54',
  'lab.chore.title': '01a17522-1ec2-7b10-9c41-0a1b2c3d4e55',
  'lab.chore.description': '01a17522-1ec2-7b10-9c41-0a1b2c3d4e56',
};
const labId = (key: string) => labIds[key] as string;
const textObject = (name: string, plural: string, label: string, field: string) =>
  defineObject({
    id: labId(`lab.${name}`),
    nameSingular: name,
    namePlural: plural,
    labelSingular: label,
    labelPlural: `${label}s`,
    icon: 'file-text',
    primaryField: labId(`lab.${name}.title`),
    fields: [
      defineField({ id: labId(`lab.${name}.title`), name: 'title', label: 'Title', type: 'text' }),
      defineField({ id: labId(`lab.${name}.${field}`), name: field, label: field, type: 'rich_text' }),
    ],
  });
const person = defineObject({
  id: '01a1751f-5f09-7114-9d75-aa3f85aab246',
  nameSingular: 'person',
  namePlural: 'people',
  labelSingular: 'Person',
  labelPlural: 'People',
  primaryField: '01a1751f-5f09-7114-9d75-ad9754a550bc',
  fields: [defineField({ id: '01a1751f-5f09-7114-9d75-ad9754a550bc', name: 'name', label: 'Name', type: 'text' })],
});
// Two objects that keep rich text under different field names, the way a document's body and a task's description do.
const lab = defineModule({
  id: '01a1751f-5f08-717d-a428-446a0ff330a8',
  version: '0.1.0',
  objects: [person, textObject('page', 'pages', 'Page', 'body'), textObject('chore', 'chores', 'Chore', 'description')],
});

const mention = (object: string, id: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'mention', attrs: { object, id, label: 'Ana' } }] }],
});

describe('Mentioned in', () => {
  const setup = async () => {
    const client = createMockClient({ workspaceId: 'ws1', manifests: [lab] });
    const schema = await client.metadata.getSchema();
    const object = schema.objects.find((candidate) => candidate.nameSingular === 'person');

    if (!object) {
      throw new Error('person is installed');
    }

    const ana = await client.records.create('person', { name: 'Ana' });
    const ion = await client.records.create('person', { name: 'Ion' });
    const show = (record = ana) => {
      const Block = mentionedInBlock.component;

      return render(
        <TestProviders client={client} schema={schema}>
          <Block config={{}} surface="record" record={record} object={object} />
        </TestProviders>,
      );
    };

    return { client, ana, ion, show };
  };

  it('lists the records of any object whose rich text mentions this one, whatever the field is called', async () => {
    const { client, ana, ion, show } = await setup();
    await client.records.create('page', { title: 'Site visit plan', body: mention('person', ana.id) });
    await client.records.create('chore', { title: 'Call Ana back', description: mention('person', ana.id) });
    await client.records.create('chore', { title: 'About Ion', description: mention('person', ion.id) });
    await client.records.create('page', { title: 'Mentions nobody' });
    show();
    const section = (await screen.findByText('Mentioned in')).closest('section') as HTMLElement;
    const links = within(section).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['Call Ana backChore', 'Site visit planPage']);
    expect(within(section).queryByText('About Ion')).toBeNull();
    expect(within(section).queryByText('Mentions nobody')).toBeNull();
  });

  it('shows nothing while no record mentions this one', async () => {
    const { client, ion, show } = await setup();
    await client.records.create('page', { title: 'Only Ion', body: mention('person', ion.id) });
    const { container } = show();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(container.querySelector('[data-slot="mentioned-in"]')).toBeNull();
    expect(screen.queryByText('Mentioned in')).toBeNull();
  });

  it('places itself at the end of every record overview', () => {
    expect(mentionedInBlock.surfaces.record).toMatchObject({ placement: 'overview' });
    expect(mentionedInBlock.surfaces.record?.objectIds).toBeUndefined();
  });
});
