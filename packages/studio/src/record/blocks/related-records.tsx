import {
  coreIds,
  defineBlockComponent,
  type FieldMetadata,
  fieldRef,
  formatRecordCount,
  primaryFieldOf,
} from '@devias/core';
import { Button, cn, Icon, Skeleton, TABLE_CELL, TABLE_HEAD, TABLE_ROW } from '@devias/ui';
import { z } from 'zod';
import { useInfiniteRecords } from '../../hooks/use-records';
import { useObject } from '../../hooks/use-schema-lookups';
import { useOpenCreateRecord } from '../../providers/create-record';
import { recordLabel } from '../../providers/labels';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { getFieldType, useFieldTypes } from '../../registries';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';

type RelatedConfig = { objectId: string; fieldId: string; limit?: number };

/** The block's query. */
const relatedQuery = (object: string, relation: string, config: RelatedConfig, recordId: string) => ({
  object,
  filter: { field: relation, op: 'eq' as const, value: recordId },
  limit: config.limit ?? 20,
  count: true,
});

/** Compact table of records of `config.objectId` whose relation field `config.fieldId` points at this record. */
export const relatedRecordsBlock = defineBlockComponent({
  id: coreIds.blocks.related_records,
  label: 'Related records',
  icon: 'list',
  config: z.object({ objectId: z.string(), fieldId: z.string(), limit: z.number().int().positive().optional() }),
  surfaces: { record: {} },
  component: ({ config, record }) => {
    const { index } = useSchema();
    const { slug } = useWorkspace();
    const { Link } = useNavigation();
    const fieldTypes = useFieldTypes();
    const openCreate = useOpenCreateRecord();
    const target = useObject(config.objectId);
    const fields = target ? (index.fieldsByObjectId.get(target.id) ?? []) : [];
    const relation = fieldRef(fields, config.fieldId);
    const primaryField = target ? primaryFieldOf(index, target) : undefined;
    const columns = fields
      .filter((f) => f.name !== primaryField?.name && f.id !== relation?.id && f.type !== 'json')
      .slice(0, 3);
    const query = useInfiniteRecords(
      relatedQuery(target?.nameSingular ?? '', relation?.name ?? '', config, record.id),
      {
        enabled: Boolean(target && relation),
      },
    );

    if (!target) {
      return <div className="text-xs text-muted-foreground">Unknown object "{config.objectId}".</div>;
    }

    return (
      <div className="flex flex-col gap-2">
        {query.isLoading ? (
          <div className="flex flex-col gap-1">
            <Skeleton className="h-7 w-full" />
            <Skeleton className="h-7 w-full" />
          </div>
        ) : query.items.length === 0 ? (
          <div className="text-xs text-muted-foreground">No {target.labelPlural.toLowerCase()} yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className={cn(TABLE_ROW)}>
                <th className={TABLE_HEAD}>{primaryField?.label ?? 'Name'}</th>
                {columns.map((f) => (
                  <th key={f.name} className={TABLE_HEAD}>
                    {f.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {query.items.map((item) => (
                <tr key={item.id} className={cn(TABLE_ROW, 'transition-colors hover:bg-background-hover/50')}>
                  <td className={cn(TABLE_CELL, 'max-w-64 truncate')}>
                    <Link
                      href={links.record(slug, target.nameSingular, item.id)}
                      className="font-medium hover:text-primary hover:underline"
                    >
                      {recordLabel(item, primaryField)}
                    </Link>
                  </td>
                  {columns.map((field) => {
                    const Cell = getFieldType(fieldTypes, field.type).cell;

                    return (
                      <td key={field.name} className={cn(TABLE_CELL, 'max-w-48')}>
                        <Cell
                          field={field as FieldMetadata & { settings: Record<string, unknown> }}
                          value={item[field.name] ?? null}
                          record={item}
                          object={target}
                        />
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="flex items-center gap-2">
          {!target.readOnly ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                openCreate({
                  object: target.nameSingular,
                  initial: relation ? { [relation.name]: record.id } : undefined,
                  onCreated: () => {},
                })
              }
            >
              <Icon name="plus" className="size-3.5" /> New {target.labelSingular.toLowerCase()}
            </Button>
          ) : null}
          {query.hasNextPage ? (
            <Button variant="ghost" size="sm" disabled={query.isFetchingNextPage} onClick={query.fetchNextPage}>
              Load more
            </Button>
          ) : null}
          {query.totalCount !== undefined ? (
            <span className="ml-auto text-xs text-muted-foreground">{formatRecordCount(query.totalCount)} total</span>
          ) : null}
        </div>
      </div>
    );
  },
});
