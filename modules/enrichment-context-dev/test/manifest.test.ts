import { readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODULE_LOGO_MAX_BYTES, triggerObjectIdOf } from '@devias/core';
import { ids as crm } from '@devias/mod-crm/manifest';
import { expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';

it('names its action apart from its id', () => {
  expect(manifest.actions.map((action) => [action.id, action.name])).toEqual([
    [ids.actions.enrich_person, 'enrich_person'],
  ]);
});

it('comes with a workflow to run by hand on a person, and one for new people that starts switched off', () => {
  const byId = new Map(manifest.workflows.map((workflow) => [workflow.id, workflow]));
  expect(byId.get(ids.workflows.enrich_person)).toMatchObject({
    trigger: { kind: 'manual' },
    steps: [{ actionId: ids.actions.enrich_person, input: { person_id: '{{record.id}}' } }],
  });
  const automatic = byId.get(ids.workflows.enrich_new_people);
  expect(automatic).toMatchObject({ enabled: false, trigger: { kind: 'record_event', types: ['record.created'] } });
  // Both are about the CRM's person.
  expect(manifest.workflows.map((workflow) => triggerObjectIdOf(workflow.trigger))).toEqual([
    crm.objects.person,
    crm.objects.person,
  ]);
});

it('asks a score of the match, 70 unless the workspace says otherwise', () => {
  expect(manifest.variables).toEqual([
    expect.objectContaining({ id: ids.variables.min_match_score, defaultValue: '70', secret: false }),
  ]);
});

it('has the logo its manifest names, within the size a logo may be', () => {
  const file = fileURLToPath(new URL('../logo.svg', import.meta.url));
  expect(manifest.logo).toBe('./logo.svg');
  expect(statSync(file).size).toBeLessThanOrEqual(MODULE_LOGO_MAX_BYTES);
  const svg = readFileSync(file, 'utf8');
  expect(svg.startsWith('<svg')).toBe(true);
  // A logo is a picture: nothing in it runs, and nothing in it is fetched.
  expect(svg).not.toMatch(/<script|onload=|href="https?:|<foreignObject/i);
});
