import {
  defineSettingsSection,
  type FieldInput,
  FieldInputSchema,
  type FieldMetadata,
  type ObjectInput,
  ObjectInputSchema,
  type ObjectMetadata,
} from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Breadcrumbs,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  Label,
  OptionSelect,
  Section,
  Switch,
  TABLE_CELL,
  TABLE_HEAD,
  TABLE_ROW,
  Textarea,
} from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../../hooks/use-mutations';
import { useClient } from '../../../providers/client';
import { useSchema } from '../../../providers/schema';
import { useStudioConfig } from '../../../providers/studio-config';
import { useWorkspace } from '../../../providers/workspace';
import { keys } from '../../../query/keys';
import { getFieldType } from '../../../registries';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';

/** A label as an API name: `Lead score` is `lead_score`. */
const apiName = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .replace(/_+$/, '');

const plural = (text: string) =>
  text.endsWith('y') ? `${text.slice(0, -1)}ies` : text.endsWith('s') ? `${text}es` : `${text}s`;

const OwnerBadge = ({ moduleId }: { moduleId: string | null }) => (
  <Badge variant="outline" className="font-mono text-xs">
    {moduleId ?? 'workspace'}
  </Badge>
);

const issuesToErrors = (issues: { path: PropertyKey[]; message: string }[]) =>
  Object.fromEntries(issues.map((i) => [String(i.path[0] ?? ''), i.message]));

// ---------------------------------------------------------------------------------------------
// Object dialog
// ---------------------------------------------------------------------------------------------

function ObjectDialog({
  existing,
  fields,
  onClose,
}: {
  existing?: ObjectMetadata;
  fields: FieldMetadata[];
  onClose: () => void;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ObjectInput>({
    nameSingular: existing?.nameSingular ?? '',
    namePlural: existing?.namePlural ?? '',
    labelSingular: existing?.labelSingular ?? '',
    labelPlural: existing?.labelPlural ?? '',
    icon: existing?.icon ?? '',
    description: existing?.description ?? '',
    primaryFieldId: existing?.primaryFieldId,
    readOnly: existing?.readOnly ?? false,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const set = (patch: Partial<ObjectInput>) => setForm((f) => ({ ...f, ...patch }));

  const submit = async () => {
    const input: ObjectInput = {
      ...form,
      icon: form.icon || undefined,
      description: form.description || undefined,
      primaryFieldId: form.primaryFieldId || undefined,
    };
    const parsed = ObjectInputSchema.safeParse(input);

    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));

      return;
    }

    setSaving(true);

    try {
      if (existing) {
        await client.metadata.objects.update(existing.id, parsed.data);
      } else {
        // The engine gives a new object its table and its row in the sidebar.
        await client.metadata.objects.create(parsed.data);
      }

      await queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });
      toast.success(existing ? 'Object updated' : 'Object created');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  const text = (key: keyof ObjectInput, label: string, placeholder?: string, mono = false) => (
    <Field data-invalid={errors[key] ? 'true' : undefined}>
      <FieldLabel htmlFor={`object-${key}`}>{label}</FieldLabel>
      <Input
        id={`object-${key}`}
        className={mono ? 'font-mono text-xs' : undefined}
        placeholder={placeholder}
        value={String(form[key] ?? '')}
        aria-invalid={errors[key] ? true : undefined}
        onChange={(e) => {
          const value = e.target.value;

          if (key === 'labelSingular' && !existing) {
            set({
              labelSingular: value,
              nameSingular: apiName(value),
              labelPlural: plural(value),
              namePlural: apiName(plural(value)),
            });
          } else {
            set({ [key]: value } as Partial<ObjectInput>);
          }
        }}
      />
      {errors[key] ? <FieldError>{errors[key]}</FieldError> : null}
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.labelSingular}` : 'New object'}</DialogTitle>
          <DialogDescription>
            Objects hold records; API names are lowercase with underscores (like lead_score) and cannot change once
            used.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup className="gap-3">
          <div className="grid grid-cols-2 gap-3">
            {text('labelSingular', 'Label (singular)', 'Candidate')}
            {text('labelPlural', 'Label (plural)', 'Candidates')}
            {text('nameSingular', 'API name (singular)', 'candidate', true)}
            {text('namePlural', 'API name (plural)', 'candidates', true)}
          </div>
          <div className="grid grid-cols-2 gap-3">
            {text('icon', 'Icon', 'user-plus')}
            <Field>
              <FieldLabel htmlFor="object-primaryField">Primary field</FieldLabel>
              <OptionSelect
                id="object-primaryField"
                className="w-full"
                value={form.primaryFieldId ?? ''}
                onValueChange={(id) => set({ primaryFieldId: id || undefined })}
                options={[
                  { value: '', label: 'First text field' },
                  ...fields.map((f) => ({ value: f.id, label: f.label })),
                ]}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="object-description">Description</FieldLabel>
            <Textarea
              id="object-description"
              rows={2}
              value={form.description ?? ''}
              onChange={(e) => set({ description: e.target.value })}
            />
          </Field>
          <Label className="flex items-center justify-between text-xs">
            <span>
              Read only{' '}
              <span className="text-muted-foreground">(records cannot be created or edited from the studio)</span>
            </span>
            <Switch checked={Boolean(form.readOnly)} onCheckedChange={(readOnly) => set({ readOnly })} />
          </Label>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Field dialog
// ---------------------------------------------------------------------------------------------

const parseDefault = (text: string): unknown => {
  const trimmed = text.trim();

  if (trimmed === '') {
    return undefined;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
};

function FieldDialog({
  object,
  existing,
  onClose,
}: {
  object: ObjectMetadata;
  existing?: FieldMetadata;
  onClose: () => void;
}) {
  const client = useClient();
  const queryClient = useQueryClient();
  const config = useStudioConfig();
  const { schema } = useSchema();
  const fieldTypes = [...config.registries.fieldTypes.values()].sort((a, b) => a.label.localeCompare(b.label));
  const [form, setForm] = useState({
    name: existing?.name ?? '',
    label: existing?.label ?? '',
    type: existing?.type ?? 'text',
    description: existing?.description ?? '',
    isRequired: existing?.isRequired ?? false,
    isUnique: existing?.isUnique ?? false,
    defaultValue: existing?.defaultValue === undefined ? '' : JSON.stringify(existing.defaultValue),
  });
  const [settings, setSettings] = useState<Record<string, unknown>>(
    existing?.settings ??
      (config.registries.fieldTypes.get('text')?.defaultSettings as Record<string, unknown> | undefined) ??
      {},
  );
  const [settingsText, setSettingsText] = useState(JSON.stringify(existing?.settings ?? {}, null, 2));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const fieldType = getFieldType(config.registries.fieldTypes, form.type);
  const SettingsEditor = fieldType.settingsEditor;

  const submit = async () => {
    let parsedSettings = settings;

    if (!SettingsEditor) {
      try {
        parsedSettings = settingsText.trim() ? (JSON.parse(settingsText) as Record<string, unknown>) : {};
      } catch {
        setErrors({ settings: 'Settings must be valid JSON' });

        return;
      }
    }

    if (fieldType.settingsSchema) {
      const check = fieldType.settingsSchema.safeParse(parsedSettings);

      if (!check.success) {
        setErrors({ settings: check.error.issues.map((i) => i.message).join(', ') });

        return;
      }
    }

    const input: FieldInput = {
      objectId: object.id,
      name: form.name,
      label: form.label,
      type: form.type,
      description: form.description || undefined,
      settings: parsedSettings,
      isRequired: form.isRequired,
      isUnique: form.isUnique,
      defaultValue: parseDefault(form.defaultValue),
    };
    const parsed = FieldInputSchema.safeParse(input);

    if (!parsed.success) {
      setErrors(issuesToErrors(parsed.error.issues));

      return;
    }

    setSaving(true);

    try {
      if (existing) {
        const { objectId: _objectId, name: _name, type: _type, ...patch } = parsed.data;
        await client.metadata.fields.update(existing.id, patch);
      } else {
        await client.metadata.fields.create(parsed.data);
      }

      await queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });
      toast.success(existing ? 'Field updated' : 'Field created');
      onClose();
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{existing ? `Edit ${existing.label}` : `New field on ${object.labelSingular}`}</DialogTitle>
          <DialogDescription>The API name and type are fixed once the field exists.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] overflow-y-auto px-0.5">
          <FieldGroup className="gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Field data-invalid={errors.label ? 'true' : undefined}>
                <FieldLabel htmlFor="field-label">Label</FieldLabel>
                <Input
                  id="field-label"
                  value={form.label}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      label: e.target.value,
                      ...(existing ? {} : { name: apiName(e.target.value) }),
                    }))
                  }
                />
                {errors.label ? <FieldError>{errors.label}</FieldError> : null}
              </Field>
              <Field data-invalid={errors.name ? 'true' : undefined}>
                <FieldLabel htmlFor="field-name">API name</FieldLabel>
                <Input
                  id="field-name"
                  className="font-mono text-xs"
                  value={form.name}
                  disabled={Boolean(existing)}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                />
                {errors.name ? <FieldError>{errors.name}</FieldError> : null}
              </Field>
            </div>
            <Field>
              <FieldLabel htmlFor="field-type">Type</FieldLabel>
              <OptionSelect
                id="field-type"
                className="w-full"
                value={form.type}
                disabled={Boolean(existing)}
                onValueChange={(type) => {
                  setForm((f) => ({ ...f, type }));
                  const defaults =
                    (config.registries.fieldTypes.get(type)?.defaultSettings as Record<string, unknown> | undefined) ??
                    {};
                  setSettings(defaults);
                  setSettingsText(JSON.stringify(defaults, null, 2));
                }}
                options={fieldTypes.map((t) => ({ value: t.type, label: `${t.label} (${t.type})`, icon: t.icon }))}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="field-description">Description</FieldLabel>
              <Input
                id="field-description"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                Required
                <Switch
                  checked={form.isRequired}
                  onCheckedChange={(isRequired) => setForm((f) => ({ ...f, isRequired }))}
                />
              </Label>
              <Label className="flex items-center justify-between rounded-lg border border-border px-3 py-2 text-xs">
                Unique
                <Switch checked={form.isUnique} onCheckedChange={(isUnique) => setForm((f) => ({ ...f, isUnique }))} />
              </Label>
            </div>
            <Field>
              <FieldLabel htmlFor="field-default">Default value</FieldLabel>
              <Input
                id="field-default"
                className="font-mono text-xs"
                placeholder='e.g. "new", 0, true'
                value={form.defaultValue}
                onChange={(e) => setForm((f) => ({ ...f, defaultValue: e.target.value }))}
              />
            </Field>
            <Section title={`${fieldType.label} settings`} className="bg-muted/20">
              {SettingsEditor ? (
                <SettingsEditor
                  objectId={object.id}
                  value={settings}
                  onChange={(next) => setSettings(next as Record<string, unknown>)}
                  schema={schema}
                />
              ) : (
                <Textarea
                  rows={4}
                  className="font-mono text-xs"
                  value={settingsText}
                  onChange={(e) => setSettingsText(e.target.value)}
                />
              )}
              {errors.settings ? <FieldError className="mt-2">{errors.settings}</FieldError> : null}
            </Section>
          </FieldGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {existing ? 'Save' : 'Create'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------------------------
// Section
// ---------------------------------------------------------------------------------------------

type DeleteTarget = { kind: 'object'; object: ObjectMetadata } | { kind: 'field'; field: FieldMetadata };

function DeleteDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: DeleteTarget | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <AlertDialog open={Boolean(target)} onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent size="sm">
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete{' '}
            {target?.kind === 'object' ? target.object.labelPlural : target?.kind === 'field' ? target.field.label : ''}
            ?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {target?.kind === 'object'
              ? 'All records of this object will be deleted.'
              : 'The value of this field will be removed from every record.'}
            {target && (target.kind === 'object' ? target.object.moduleId : target.field.moduleId)
              ? ' It is owned by a module: re-applying that module will recreate it.'
              : ''}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** A module's id as a heading: short ids are acronyms (crm), the rest are names (inventory). */
const moduleTitle = (moduleId: string) =>
  moduleId.length <= 3 ? moduleId.toUpperCase() : `${moduleId.charAt(0).toUpperCase()}${moduleId.slice(1)}`;

/** Every object, grouped by the module that owns it, one row each; an object's fields and settings open on a page of their own. */
function ObjectsList() {
  const { schema, index } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const [objectDialog, setObjectDialog] = useState(false);
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown = schema.objects.filter(
      (o) =>
        !needle ||
        [o.labelSingular, o.labelPlural, o.nameSingular, o.namePlural].some((text) =>
          text.toLowerCase().includes(needle),
        ),
    );
    const byModule = new Map<string | null, ObjectMetadata[]>();

    for (const o of shown) {
      byModule.set(o.moduleId ?? null, [...(byModule.get(o.moduleId ?? null) ?? []), o]);
    }

    // The workspace's own objects first, then the modules' by name.
    return [...byModule.entries()]
      .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
      .map(([moduleId, objects]) => ({ moduleId, objects }));
  }, [schema.objects, query]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search objects"
            aria-label="Search objects"
            className="pl-8"
          />
        </div>
        <Button size="sm" onClick={() => setObjectDialog(true)}>
          <Icon name="plus" className="size-3.5" /> New object
        </Button>
      </div>
      {schema.objects.length === 0 ? (
        <EmptyState icon="database" title="No objects yet" description="Create your first object to start." />
      ) : groups.length === 0 ? (
        <p className="py-8 text-center text-xs text-muted-foreground">No object matches “{query.trim()}”.</p>
      ) : (
        groups.map(({ moduleId, objects }) => (
          <section key={moduleId ?? 'workspace'} data-module={moduleId ?? 'workspace'} className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              {moduleId ? moduleTitle(moduleId) : 'Workspace'}
              <span className="font-normal">{objects.length}</span>
            </h2>
            <ul
              className="rounded-lg bg-card p-1 ring-1 ring-card-border"
              aria-label={moduleId ? moduleTitle(moduleId) : 'Workspace'}
            >
              {objects.map((o) => (
                <li key={o.id} data-object={o.nameSingular}>
                  <navigation.Link
                    href={links.settings(slug, 'data-model', o.nameSingular)}
                    className="flex items-center gap-3 rounded-xs px-3 py-2.5 transition-colors hover:bg-muted"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-muted text-muted-foreground">
                      <Icon name={o.icon ?? 'box'} className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-xs font-medium">{o.labelPlural}</span>
                        {o.isSystem ? <Badge variant="secondary">system</Badge> : null}
                      </span>
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {o.nameSingular} / {o.namePlural}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {countLabel(index.fieldsByObjectId.get(o.id)?.length ?? 0, 'field')}
                    </span>
                    <Icon name="chevron-right" className="size-4 shrink-0 text-muted-foreground" />
                  </navigation.Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {objectDialog ? <ObjectDialog fields={[]} onClose={() => setObjectDialog(false)} /> : null}
    </div>
  );
}

const countLabel = (count: number, one: string) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** One object: its fields, with the actions to edit or delete the object and its fields. */
function ObjectDetail({ object }: { object: ObjectMetadata }) {
  const { index } = useSchema();
  const client = useClient();
  const queryClient = useQueryClient();
  const config = useStudioConfig();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const fields = index.fieldsByObjectId.get(object.id) ?? [];
  const [objectDialog, setObjectDialog] = useState(false);
  const [fieldDialog, setFieldDialog] = useState<{ existing?: FieldMetadata } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const listHref = links.settings(slug, 'data-model');

  const confirmDelete = async () => {
    if (!deleteTarget) {
      return;
    }

    const target = deleteTarget;

    try {
      if (target.kind === 'object') {
        await client.metadata.objects.delete(target.object.id);
      } else {
        await client.metadata.fields.delete(target.field.id);
      }

      await queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });
      toast.success(target.kind === 'object' ? 'Object deleted' : 'Field deleted');

      if (target.kind === 'object') {
        navigation.navigate(listHref);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs
        items={[{ label: 'Data model', href: listHref }, { label: object.labelPlural }]}
        linkComponent={navigation.Link}
        className="-ml-1"
      />
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-muted-foreground">
            <Icon name={object.icon ?? 'box'} className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-medium">
              <span className="truncate">{object.labelPlural}</span>
              {object.moduleId ? <OwnerBadge moduleId={object.moduleId} /> : null}
              {object.isSystem ? <Badge variant="secondary">system</Badge> : null}
              {object.readOnly ? <Badge variant="secondary">read only</Badge> : null}
            </h2>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground" title={object.id}>
              {object.nameSingular} / {object.namePlural}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setObjectDialog(true)}>
            <Icon name="pencil" className="size-3.5" /> Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            disabled={object.isSystem}
            onClick={() => setDeleteTarget({ kind: 'object', object })}
          >
            <Icon name="trash-2" className="size-3.5" /> Delete
          </Button>
        </div>
      </header>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-xs font-medium">
            Fields <span className="ml-1 font-normal text-muted-foreground tabular-nums">{fields.length}</span>
          </h3>
          <Button size="sm" onClick={() => setFieldDialog({})}>
            <Icon name="plus" className="size-3.5" /> New field
          </Button>
        </div>
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead>
              <tr className={TABLE_ROW}>
                <th className={TABLE_HEAD}>Field</th>
                <th className={TABLE_HEAD}>Type</th>
                <th className={TABLE_HEAD}>Rules</th>
                <th className={cn(TABLE_HEAD, 'w-24')} />
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => {
                const type = config.registries.fieldTypes.get(field.type);
                const rules = [field.isRequired ? 'Required' : null, field.isUnique ? 'Unique' : null].filter(Boolean);

                return (
                  <tr key={field.id} className={TABLE_ROW}>
                    <td className={TABLE_CELL}>
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{field.label}</span>
                      </span>
                      <span className="block font-mono text-xs text-muted-foreground">{field.name}</span>
                    </td>
                    <td className={TABLE_CELL}>
                      <span className="flex items-center gap-2">
                        <Icon name={type?.icon ?? 'circle-help'} className="size-3.5 text-muted-foreground" />
                        {type?.label ?? field.type}
                        {!type ? (
                          <Badge variant="outline" className="text-xs">
                            unknown
                          </Badge>
                        ) : null}
                      </span>
                    </td>
                    <td className={cn(TABLE_CELL, 'text-muted-foreground')}>{rules.join(' · ')}</td>
                    <td className={TABLE_CELL}>
                      <span className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Edit field"
                          className="text-muted-foreground"
                          onClick={() => setFieldDialog({ existing: field })}
                        >
                          <Icon name="pencil" className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Delete field"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteTarget({ kind: 'field', field })}
                        >
                          <Icon name="trash-2" className="size-3.5" />
                        </Button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      {objectDialog ? <ObjectDialog existing={object} fields={fields} onClose={() => setObjectDialog(false)} /> : null}
      {fieldDialog ? (
        <FieldDialog object={object} existing={fieldDialog.existing} onClose={() => setFieldDialog(null)} />
      ) : null}
      <DeleteDialog
        target={deleteTarget}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

function DataModelSettings() {
  const { schema } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const key = navigation.params.item;

  if (!key) {
    return <ObjectsList />;
  }

  const object = schema.objects.find((o) => o.nameSingular === key);

  if (!object) {
    return (
      <EmptyState
        icon="circle-help"
        title="Unknown object"
        description={`No object named "${key}".`}
        action={
          <Button size="lg" variant="outline" onClick={() => navigation.navigate(links.settings(slug, 'data-model'))}>
            Back to the data model
          </Button>
        }
      />
    );
  }

  return <ObjectDetail object={object} />;
}

export const dataModelSection = defineSettingsSection({
  name: 'data-model',
  label: 'Data model',
  icon: 'database',
  group: 'data',
  requiresRole: 'admin',
  component: DataModelSettings,
});
