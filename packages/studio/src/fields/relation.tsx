import {
  defineFieldType,
  opsForFieldType,
  primaryFieldOf,
  type RelationSettings,
  RelationSettingsSchema,
} from '@devias/core';
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  Icon,
  Input,
  Label,
  OptionSelect,
} from '@devias/ui';
import { useMemo, useState } from 'react';
import { useDebouncedValue } from '../hooks/use-debounced-value';
import { useRecords } from '../hooks/use-records';
import { useRelatedLabels } from '../hooks/use-related-labels';
import { recordLabel } from '../providers/labels';
import { useSchema } from '../providers/schema';
import { useWorkspace } from '../providers/workspace';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';
import { Empty, isEmptyValue, stopRowClick } from './shared';

interface Item {
  id: string;
  label: string;
}

function RelationCell({ value, field }: { value: string | null; field: { settings: RelationSettings } }) {
  const { index } = useSchema();
  const { slug } = useWorkspace();
  const { Link } = useNavigation();
  const target = index.objectsById.get(field.settings.targetObjectId);
  const labels = useRelatedLabels(target?.nameSingular, [value]);

  if (isEmptyValue(value)) {
    return <Empty />;
  }

  const id = value as string;

  if (!target) {
    return <span className="truncate">{id}</span>;
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: stops row handlers; the link inside is the control
    <span onClick={stopRowClick} onKeyDown={stopRowClick} className="flex min-w-0">
      <Link
        href={links.record(slug, target.nameSingular, id)}
        className="inline-flex h-6 min-w-0 items-center gap-1 rounded-sm border border-border px-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
      >
        <Icon name={target.icon ?? 'box'} className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{labels.get(id)}</span>
      </Link>
    </span>
  );
}

function RelationEditor({
  field,
  value,
  onChange,
  mode,
  onCommit,
  onCancel,
  autoFocus,
  disabled,
  invalid,
}: {
  field: { settings: RelationSettings; label: string };
  value: string | null;
  onChange: (value: string | null) => void;
  mode: 'form' | 'inline';
  onCommit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const { index } = useSchema();
  const target = index.objectsById.get(field.settings.targetObjectId);
  const primaryField = target ? primaryFieldOf(index, target) : undefined;
  const [input, setInput] = useState('');
  const search = useDebouncedValue(input, 200);
  const records = useRecords(
    target ? { object: target.nameSingular, ...(search.trim() ? { search: search.trim() } : {}), limit: 20 } : null,
  );
  const current = useRelatedLabels(target?.nameSingular, [value]);
  const items = useMemo<Item[]>(() => {
    const list = (records.data?.items ?? []).map((r) => ({ id: r.id, label: recordLabel(r, primaryField) }));

    if (value && !list.some((i) => i.id === value)) {
      list.unshift({ id: value, label: current.get(value) });
    }

    return list;
  }, [records.data, primaryField, value, current]);
  const selected = items.find((i) => i.id === value) ?? null;

  if (!target) {
    return <Input value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} disabled={disabled} />;
  }

  return (
    <Combobox
      items={items}
      value={selected}
      filter={null}
      inputValue={input}
      onInputValueChange={setInput}
      itemToStringLabel={(item: Item) => item.label}
      isItemEqualToValue={(a: Item, b: Item) => a.id === b.id}
      disabled={disabled}
      defaultOpen={mode === 'inline'}
      onValueChange={(item: Item | null) => {
        onChange(item?.id ?? null);

        if (mode === 'inline') {
          onCommit?.();
        }
      }}
      onOpenChange={(open) => {
        if (!open && mode === 'inline') {
          onCancel?.();
        }
      }}
    >
      <ComboboxInput
        placeholder={`Search ${target.labelPlural.toLowerCase()}…`}
        autoFocus={autoFocus}
        showClear={Boolean(value)}
        aria-invalid={invalid || undefined}
        className="w-full"
      />
      <ComboboxContent>
        <ComboboxEmpty>{records.isPending ? 'Searching…' : 'No results'}</ComboboxEmpty>
        <ComboboxList>
          {(item: Item) => (
            <ComboboxItem key={item.id} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

export const relationFieldType = defineFieldType<string, RelationSettings>({
  type: 'relation',
  label: 'Relation',
  icon: 'link',
  category: 'relation',
  settingsSchema: RelationSettingsSchema,
  cell: ({ value, field }) => <RelationCell value={value} field={field} />,
  editor: (props) => <RelationEditor {...props} />,
  filter: { operators: opsForFieldType('relation') },
  sortable: false,
  groupable: false,
  searchable: false,
  toText: (value) => value ?? '',
  settingsEditor: ({ value, onChange, schema }) => (
    <div className="flex flex-col gap-3">
      <Label className="flex flex-col items-stretch gap-1.5">
        <span>Target object</span>
        <OptionSelect
          className="w-full"
          aria-label="Target object"
          placeholder="Select an object…"
          value={value.targetObjectId}
          onValueChange={(targetObjectId) =>
            onChange({ ...value, relationType: 'many_to_one', targetObjectId: targetObjectId })
          }
          options={schema.objects.map((object) => ({
            value: object.id,
            label: object.labelPlural,
            ...(object.icon ? { icon: object.icon } : {}),
          }))}
        />
      </Label>
      <Label className="flex flex-col items-stretch gap-1.5">
        <span>Inverse label</span>
        <Input
          placeholder="People"
          value={value.inverseLabel ?? ''}
          onChange={(e) => onChange({ ...value, inverseLabel: e.target.value || undefined })}
        />
      </Label>
    </div>
  ),
});
