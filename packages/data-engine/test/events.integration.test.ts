import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runRaw } from '../src';
import { createTestEngine, type TestEngine } from './helpers/db';

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('the event log on PGlite', () => {
  let t: TestEngine;

  beforeAll(async () => {
    t = await createTestEngine();
  });
  afterAll(() => t.close());

  it('gives every event an identity of its own, in the order of the log', async () => {
    await t.engine.records.create(t.owner, 'company', { name: 'Globex' });
    await t.engine.records.create(t.owner, 'company', { name: 'Initech' });
    const rows = await runRaw<{ sequence: unknown; id: string }>(
      t.db,
      sql`SELECT sequence, id FROM event WHERE workspace_id = ${t.workspaceId} ORDER BY sequence`,
    );
    expect(rows.length).toBeGreaterThan(2);

    for (const row of rows) {
      expect(row.id).toMatch(UUID_V7);
    }

    const ids = rows.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    // Made in the order the events are written, so the ids sort like the sequence (within one process; `sequence` stays the cursor).
    expect(ids).toEqual([...ids].sort());
  });
});
