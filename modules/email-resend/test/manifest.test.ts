import { expect, it } from 'vitest';
import { manifest } from '../src/manifest';
import { ids } from '../src/manifest/ids';

it('names its action apart from its id', () => {
  expect(manifest.actions.map((action) => [action.id, action.name])).toEqual([[ids.actions.send_email, 'send_email']]);
});
