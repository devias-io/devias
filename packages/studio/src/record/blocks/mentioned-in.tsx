import {
  coreIds,
  defineBlockComponent,
  type FieldMetadata,
  type Filter,
  type LinkTarget,
  linkHref,
  type ObjectMetadata,
  primaryFieldOf,
  type RecordData,
} from '@devias/core';
import { cn, Icon, type IconName, Section } from '@devias/ui';
import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { mentionsRecordFilter } from '../../editor/rich-text';
import { useDocumentsMentioning } from '../../hooks/use-documents';
import { useTasks } from '../../hooks/use-tasks';
import { useClient } from '../../providers/client';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { UNTITLED_RECORD_LABEL } from '../../views/view-state';

/** What can be mentioned: a record, a document or a task. */
export type MentionTarget =
  | { kind: 'record'; object: ObjectMetadata; id: string }
  | { kind: 'document'; id: string }
  | { kind: 'task'; id: string };

/** Something that mentions the target: a record of any object, or a document. */
interface Mentioning {
  key: string;
  href: string;
  icon: IconName;
  label: string;
  /** What it is, shown as a tag: "Task", "Document". */
  kind: string;
}

/** The objects that have rich-text fields, with those fields: where a mention can be written. */
const useRichTextObjects = (): { object: ObjectMetadata; fields: FieldMetadata[]; label: string | undefined }[] => {
  const { index } = useSchema();

  return useMemo(
    () =>
      index.schema.objects.flatMap((object) => {
        const fields = (index.fieldsByObjectId.get(object.id) ?? []).filter((field) => field.type === 'rich_text');

        return fields.length > 0 ? [{ object, fields, label: primaryFieldOf(index, object)?.name }] : [];
      }),
    [index],
  );
};

/** Records of any object whose rich text mentions the id (never the record itself), by object then label. */
const useMentioningRecords = (target: MentionTarget): Mentioning[] => {
  const client = useClient();
  const { slug } = useWorkspace();
  const targets = useRichTextObjects();
  const own = target.kind === 'record' ? target.object.id : null;
  const found = useQueries({
    queries: targets.map((candidate) => {
      const mentions = candidate.fields.map((field): Filter => mentionsRecordFilter(target.id, field.name));
      const query = {
        object: candidate.object.nameSingular,
        ...(candidate.label ? { select: [candidate.label] } : {}),
        filter: mentions.length === 1 ? (mentions[0] as Filter) : { or: mentions },
        limit: 50,
      };

      return {
        // Under the object's records, so changing any of them refreshes what mentions the record.
        queryKey: keys.list(client.workspaceId, query),
        queryFn: () => client.records.list(query),
      };
    }),
    // The records of each object, in the order of `targets`; unchanged data keeps its identity between renders.
    combine: (results) => results.map((result) => result.data?.items),
  });

  return useMemo(
    () =>
      targets.flatMap((candidate, i) =>
        (found[i] ?? [])
          .filter((record) => !(candidate.object.id === own && record.id === target.id))
          .map((record): Mentioning => {
            const label = candidate.label ? record[candidate.label] : undefined;

            return {
              key: `${candidate.object.id}:${record.id}`,
              href: links.record(slug, candidate.object.nameSingular, record.id),
              icon: candidate.object.icon ?? 'file',
              label: typeof label === 'string' && label ? label : UNTITLED_RECORD_LABEL,
              kind: candidate.object.labelSingular,
            };
          }),
      ),
    [targets, found, own, target.id, slug],
  );
};

/** Everything that mentions the target: documents (from the link index) and records, by kind then label. */
const useMentioning = (target: MentionTarget): Mentioning[] => {
  const { slug } = useWorkspace();
  const link = useMemo<LinkTarget>(
    () =>
      target.kind === 'record'
        ? { kind: 'record', object: target.object.nameSingular, id: target.id }
        : { kind: target.kind, id: target.id },
    [target],
  );
  const documents = useDocumentsMentioning(link);
  const tasks = useTasks({ mentions: linkHref(link), sort: 'updated' }, 50);
  const records = useMentioningRecords(target);

  return useMemo(
    () =>
      [
        ...(documents.data?.items ?? [])
          .filter((document) => !(target.kind === 'document' && document.id === target.id))
          .map(
            (document): Mentioning => ({
              key: `document:${document.id}`,
              href: links.document(slug, document.id),
              icon: 'file-text',
              label: document.title || UNTITLED_RECORD_LABEL,
              kind: 'Document',
            }),
          ),
        ...(tasks.data?.pages[0]?.items ?? [])
          .filter((task) => !(target.kind === 'task' && task.id === target.id))
          .map(
            (task): Mentioning => ({
              key: `task:${task.id}`,
              href: links.task(slug, task.id),
              icon: 'check-square',
              label: task.title || UNTITLED_RECORD_LABEL,
              kind: 'Task',
            }),
          ),
        ...records,
      ].sort((a, b) => a.kind.localeCompare(b.kind) || a.label.localeCompare(b.label)),
    [documents.data, tasks.data, records, slug, target],
  );
};

function Links({ items }: { items: Mentioning[] }) {
  const navigation = useNavigation();

  return (
    <ul className="-mx-1.5 flex flex-col">
      {items.map(({ key, href, icon, label, kind }) => (
        <li key={key}>
          <navigation.Link
            href={href}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 text-xs hover:bg-muted"
          >
            <Icon name={icon} className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate">{label}</span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">{kind}</span>
          </navigation.Link>
        </li>
      ))}
    </ul>
  );
}

/** Backlinks at the end of a page in its quiet style (a document's), nothing until something mentions the target. */
export function MentionedInList({ target, className }: { target: MentionTarget; className?: string }) {
  const items = useMentioning(target);

  if (items.length === 0) {
    return null;
  }

  return (
    <section className={cn('border-t border-border pt-4', className)} data-slot="mentioned-in">
      <h2 className="mb-1 text-xs font-medium text-muted-foreground">Mentioned in</h2>
      <Links items={items} />
    </section>
  );
}

/** The same as a section, like the other widgets of a record page. */
export function MentionedInSection({ object, record }: { object: ObjectMetadata; record: RecordData }) {
  const items = useMentioning({ kind: 'record', object, id: record.id });

  if (items.length === 0) {
    return null;
  }

  return (
    <Section variant="plain" title="Mentioned in">
      <Links items={items} />
    </Section>
  );
}

/** "Mentioned in" at the end of every record page's overview, unless its layout places it. */
export const mentionedInBlock = defineBlockComponent({
  id: coreIds.blocks.mentioned_in,
  label: 'Mentioned in',
  icon: 'file-text',
  // Draws its own card, so it can stay out of the way when nothing mentions the record.
  surfaces: { record: { placement: 'overview', frame: false } },
  component: ({ record, object }) => (record && object ? <MentionedInSection object={object} record={record} /> : null),
});
