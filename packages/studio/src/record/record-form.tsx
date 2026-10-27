import type { FieldMetadata, FieldTypeDefinition, ObjectMetadata, RecordData } from '@devias/core';
import { valueSchemaForField } from '@devias/core';
import { Field, FieldError, FieldGroup, FieldLabel } from '@devias/ui';
import { zodResolver } from '@hookform/resolvers/zod';
import { type ReactNode, useMemo } from 'react';
import { Controller, type Resolver, useForm } from 'react-hook-form';
import { z } from 'zod';
import { useFields } from '../hooks/use-schema-lookups';
import { getFieldType, useFieldTypes } from '../registries';

type FormValues = Record<string, unknown>;

const isBlank = (value: unknown) => value === null || value === undefined || value === '';

const wrap = (base: z.ZodType<unknown>, required: boolean): z.ZodType<unknown> =>
  z
    .custom<unknown>(() => true)
    .superRefine((value, ctx) => {
      if (isBlank(value)) {
        if (required) {
          ctx.addIssue({ code: 'custom', message: 'Required' });
        }

        return;
      }

      const result = base.safeParse(value);

      if (!result.success) {
        for (const issue of result.error.issues) {
          ctx.addIssue({ code: 'custom', message: issue.message });
        }
      }
    });

/** One zod schema for a record form, from field metadata (+ a field type's `valueSchema` override). */
export const buildFormSchema = (fields: FieldMetadata[], fieldTypes: Map<string, FieldTypeDefinition>) =>
  z.object(
    Object.fromEntries(
      fields.map((field) => {
        const type = fieldTypes.get(field.type);
        const base =
          type?.valueSchema?.(field as FieldMetadata & { settings: Record<string, unknown> }) ??
          valueSchemaForField({ type: field.type, settings: field.settings, isRequired: true });

        return [field.name, wrap(base as z.ZodType<unknown>, field.isRequired)];
      }),
    ),
  );

export const defaultValuesFor = (
  fields: FieldMetadata[],
  fieldTypes: Map<string, FieldTypeDefinition>,
  initial: Partial<RecordData> = {},
): FormValues =>
  Object.fromEntries(
    fields.map((field) => {
      const type = getFieldType(fieldTypes, field.type);
      const fromInitial = initial[field.name];
      const value =
        fromInitial !== undefined
          ? fromInitial
          : field.defaultValue !== undefined
            ? field.defaultValue
            : (type.defaultValue?.(field as FieldMetadata & { settings: Record<string, unknown> }) ?? null);

      return [field.name, value];
    }),
  );

export interface RecordFormProps {
  object: ObjectMetadata;
  /** Defaults to every field of the object. */
  fields?: FieldMetadata[];
  initial?: Partial<RecordData>;
  onSubmit: (values: FormValues) => Promise<void> | void;
  /** DOM id so a footer outside the form can submit it. */
  id?: string;
  footer?: (state: { submitting: boolean }) => ReactNode;
}

/** react-hook-form + zod over the field types' `editor` components in `form` mode. */
export function RecordForm({ object, fields: explicitFields, initial, onSubmit, id, footer }: RecordFormProps) {
  const fieldTypes = useFieldTypes();
  const objectFields = useFields(object.id);
  const fields = explicitFields ?? objectFields;
  const schema = useMemo(() => buildFormSchema(fields, fieldTypes), [fields, fieldTypes]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema) as unknown as Resolver<FormValues>,
    defaultValues: defaultValuesFor(fields, fieldTypes, initial),
    mode: 'onSubmit',
  });
  const submit = form.handleSubmit(async (values) => {
    const cleaned = Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v === '' ? null : v]));
    await onSubmit(cleaned);
  });

  return (
    <form id={id} onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <FieldGroup className="gap-4">
        {fields.map((field) => {
          const type = getFieldType(fieldTypes, field.type);
          const Editor = type.editor;
          const error = form.formState.errors[field.name];

          return (
            <Field key={field.name} data-invalid={error ? 'true' : undefined} data-field={field.name}>
              <FieldLabel>
                {field.label}
                {field.isRequired ? <span className="text-destructive">*</span> : null}
              </FieldLabel>
              <Controller
                control={form.control}
                name={field.name}
                render={({ field: controller, fieldState }) => (
                  <Editor
                    field={field as FieldMetadata & { settings: Record<string, unknown> }}
                    value={controller.value === undefined ? null : controller.value}
                    onChange={controller.onChange}
                    mode="form"
                    invalid={Boolean(fieldState.error)}
                    object={object}
                  />
                )}
              />
              {error ? <FieldError errors={[{ message: String(error.message ?? 'Invalid value') }]} /> : null}
            </Field>
          );
        })}
      </FieldGroup>
      {footer?.({ submitting: form.formState.isSubmitting })}
    </form>
  );
}
