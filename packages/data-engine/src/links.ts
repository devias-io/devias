import { linkOfMention, mentionsOf, objectByKey, type RichTextDoc, type SchemaIndex } from '@devias/core';
import { sql } from 'drizzle-orm';
import { type Db, runRaw } from './db/exec';

/** What a stored text mentions that an index keeps: records (by their object's id), documents, tasks and assets. */
export interface IndexedLink {
  kind: 'record' | 'document' | 'task' | 'asset';
  /** The record's object id; empty for the rest. */
  objectId: string;
  targetId: string;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The links of a text worth indexing, once each. Workflows, members, agents, unknown objects and bad ids are skipped; so is `selfId`. */
export const indexedLinksOf = (
  index: SchemaIndex,
  body: RichTextDoc,
  selfKind: IndexedLink['kind'],
  selfId: string,
) => {
  const found = new Map<string, IndexedLink>();

  for (const mention of mentionsOf(body)) {
    const target = linkOfMention(mention.object, mention.id);

    if (target.kind === 'workflow' || target.kind === 'member' || target.kind === 'agent' || !UUID.test(target.id)) {
      continue;
    }

    if (target.kind === 'record') {
      const object = objectByKey(index, target.object);

      if (object) {
        found.set(`record/${object.id}/${target.id}`, { kind: 'record', objectId: object.id, targetId: target.id });
      }
    } else if (!(target.kind === selfKind && target.id === selfId)) {
      found.set(`${target.kind}//${target.id}`, { kind: target.kind, objectId: '', targetId: target.id });
    }
  }

  return [...found.values()];
};

/** The index row a link target is stored as, or why it cannot be indexed. */
export type IndexedLinkResult = { link: IndexedLink; problem?: undefined } | { link?: undefined; problem: string };

export const indexedLinkOf = (index: SchemaIndex, target: ReturnType<typeof linkOfMention>): IndexedLinkResult => {
  if (target.kind === 'workflow' || target.kind === 'member' || target.kind === 'agent') {
    const what = target.kind === 'member' ? 'Members' : target.kind === 'agent' ? 'Agents' : 'Workflows';

    return { problem: `${what} are not indexed: use a record, a document, a task or an asset` };
  }

  if (!UUID.test(target.id)) {
    return { problem: `Invalid target id "${target.id}"` };
  }

  if (target.kind === 'record') {
    const object = objectByKey(index, target.object);

    return object
      ? { link: { kind: 'record', objectId: object.id, targetId: target.id } }
      : { problem: `Unknown object "${target.object}"` };
  }

  return { link: { kind: target.kind, objectId: '', targetId: target.id } };
};

/** `text` of a stored link back as the entity link a person reads: `record:person/<id>`, `document:<id>`, `task:<id>`, `asset:<id>`. */
export const linkTextOf = (index: SchemaIndex, link: IndexedLink): string => {
  if (link.kind === 'record') {
    const object = index.objectsById.get(link.objectId);

    return `record:${object?.nameSingular ?? link.objectId}/${link.targetId}`;
  }

  return `${link.kind}:${link.targetId}`;
};

/** Replace the mentions of one task or document with `links`, in the transaction of the write that changed its text. */
export const replaceMentions = async (
  tx: Db,
  entityKind: 'task' | 'document',
  workspaceId: string,
  entityId: string,
  links: (IndexedLink & { role?: string })[],
) => {
  await runRaw(tx, sql`DELETE FROM mention WHERE entity_kind = ${entityKind} AND entity_id = ${entityId}::uuid`);

  if (links.length === 0) {
    return;
  }

  const values = sql.join(
    links.map(
      (link) =>
        sql`(${workspaceId}, ${entityKind}, ${entityId}::uuid, ${link.kind}, ${link.objectId}, ${link.targetId}::uuid, ${link.role ?? 'mention'})`,
    ),
    sql`, `,
  );
  await runRaw(
    tx,
    sql`INSERT INTO mention (workspace_id, entity_kind, entity_id, kind, object_id, target_id, role) VALUES ${values}`,
  );
};
