import { describe, expect, it } from 'vitest';
import { manifest } from '../src/manifest';

const object = (name: string) => {
  const found = manifest.objects.find((candidate) => candidate.nameSingular === name);

  if (!found) {
    throw new Error(`the CRM has a ${name}`);
  }

  return found;
};
const typesOf = (name: string) => Object.fromEntries(object(name).fields.map((field) => [field.name, field.type]));

describe('person and company fields', () => {
  it('keeps the web addresses, mail and numbers in typed fields', () => {
    expect(typesOf('person')).toMatchObject({
      email: 'email',
      phone: 'phone',
      linkedin: 'url',
      twitter: 'url',
      github: 'url',
      website: 'url',
      owner: 'member',
      seniority: 'select',
      department: 'select',
      stage: 'select',
    });
    expect(typesOf('company')).toMatchObject({
      domain: 'url',
      logo: 'url',
      linkedin: 'url',
      email: 'email',
      phone: 'phone',
      owner: 'member',
      description: 'text',
    });
  });

  it('gives each field its own position', () => {
    for (const name of ['person', 'company']) {
      const positions = object(name).fields.map((field) => field.position);
      expect(new Set(positions).size).toBe(positions.length);
    }
  });

  it('lists in the layouts and views only fields the object has', () => {
    for (const [name, layoutName] of [
      ['person', 'Person'],
      ['company', 'Company'],
    ] as const) {
      const knownIds = new Set(object(name).fields.map((field) => field.id));
      const layout = manifest.layouts.find((candidate) => candidate.label === layoutName);
      // The fields a layout lists, in its header and in its tabs.
      const cells = layout?.shell === 'tabs' ? layout.tabs.flatMap((tab) => tab.blocks) : [];
      const listed = cells.flatMap((cell) => (cell.config as { fieldIds?: string[] } | undefined)?.fieldIds ?? []);
      expect(listed.length).toBeGreaterThan(0);

      for (const field of listed) {
        expect(knownIds.has(field), `${name}.${field}`).toBe(true);
      }

      const view = manifest.views.find((candidate) => candidate.objectId === object(name).id && candidate.isDefault);

      for (const column of view?.fields ?? []) {
        expect(knownIds.has(column.fieldId), `${name} view ${column.fieldId}`).toBe(true);
      }
    }
  });
});
