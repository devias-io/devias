import { defineFieldType, opsForFieldType, SEARCHABLE_FIELD_TYPES, SORTABLE_FIELD_TYPES } from '@devias/core';
import { Avatar, AvatarFallback, AvatarImage, cn, Icon, type IconName, Input, Switch } from '@devias/ui';
import { z } from 'zod';
import { Empty, inlineKeyHandler, isEmptyValue, stopRowClick } from './shared';

/** Email, phone and web addresses: links in the brand colour, underlined on hover. */
const linkClass =
  'truncate text-foreground underline decoration-transparent underline-offset-4 transition-colors hover:decoration-foreground';

const editorFor =
  (type: 'email' | 'tel' | 'url', placeholder?: string) =>
  ({
    value,
    onChange,
    mode,
    onCommit,
    onCancel,
    autoFocus,
    disabled,
    invalid,
  }: {
    value: string | null;
    onChange: (value: string | null) => void;
    mode: 'form' | 'inline';
    onCommit?: () => void;
    onCancel?: () => void;
    autoFocus?: boolean;
    disabled?: boolean;
    invalid?: boolean;
  }) => (
    <Input
      type={type}
      placeholder={placeholder}
      className={mode === 'inline' ? 'h-7' : undefined}
      value={value ?? ''}
      autoFocus={autoFocus}
      disabled={disabled}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      onBlur={mode === 'inline' ? onCommit : undefined}
      onKeyDown={inlineKeyHandler(onCommit, onCancel)}
    />
  );

export const emailFieldType = defineFieldType<string, Record<string, never>>({
  type: 'email',
  label: 'Email',
  icon: 'mail',
  category: 'basic',
  cell: ({ value }) =>
    isEmptyValue(value) ? (
      <Empty />
    ) : (
      <a href={`mailto:${value}`} className={linkClass} onClick={stopRowClick}>
        {value}
      </a>
    ),
  editor: editorFor('email'),
  filter: { operators: opsForFieldType('email') },
  sortable: SORTABLE_FIELD_TYPES.has('email'),
  groupable: false,
  searchable: SEARCHABLE_FIELD_TYPES.has('email'),
  toText: (value) => value ?? '',
});

export const phoneFieldType = defineFieldType<string, Record<string, never>>({
  type: 'phone',
  label: 'Phone',
  icon: 'phone',
  category: 'basic',
  cell: ({ value }) =>
    isEmptyValue(value) ? (
      <Empty />
    ) : (
      <a href={`tel:${value}`} className={linkClass} onClick={stopRowClick}>
        {value}
      </a>
    ),
  editor: editorFor('tel'),
  filter: { operators: opsForFieldType('phone') },
  sortable: SORTABLE_FIELD_TYPES.has('phone'),
  groupable: false,
  searchable: SEARCHABLE_FIELD_TYPES.has('phone'),
  toText: (value) => value ?? '',
});

/** Where a stored address leads: as it is when it has a scheme, else over https. */
export const externalHref = (value: string): string => (/^https?:\/\//i.test(value) ? value : `https://${value}`);

/** An address to read: without its scheme, a leading `www.` and a closing slash. */
export const shortAddress = (value: string): string =>
  value
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/+$/, '');

/**
 * The picture of a record, such as a company's logo: contained in a small rounded square, with the object's icon
 * standing in until there is one, or when it will not load.
 */
export function RecordImage({
  src,
  icon = 'box',
  className,
}: {
  src?: string | null;
  icon?: IconName;
  className?: string;
}) {
  const url = src?.trim();

  return (
    <Avatar data-slot="record-image" className={cn('size-6 shrink-0 rounded-xs after:rounded-xs', className)}>
      {url ? <AvatarImage src={externalHref(url)} alt="" className="rounded-xs bg-white object-contain p-0.5" /> : null}
      <AvatarFallback className="rounded-xs">
        <Icon name={icon} className="size-3.5" />
      </AvatarFallback>
    </Avatar>
  );
}

interface UrlSettings {
  /** The link is a picture of the record (a logo, a photo): the cell draws it, and tables draw it beside the name. */
  image?: boolean;
}

const addressLink = (value: string) => (
  <a href={externalHref(value)} target="_blank" rel="noreferrer noopener" className={linkClass} onClick={stopRowClick}>
    {shortAddress(value)}
  </a>
);

export const urlFieldType = defineFieldType<string, UrlSettings>({
  type: 'url',
  label: 'URL',
  icon: 'link',
  category: 'basic',
  settingsSchema: z.object({ image: z.boolean().optional() }),
  // In a table an image field is its picture alone; the address is a click into the record away.
  cell: ({ field, value, object }) =>
    isEmptyValue(value) ? (
      <Empty />
    ) : field.settings.image ? (
      <RecordImage src={value as string} icon={object.icon as IconName | undefined} className="size-5" />
    ) : (
      addressLink(value as string)
    ),
  // On a record's page the picture comes with the address it was read from.
  display: ({ field, value, object }) =>
    isEmptyValue(value) ? (
      <Empty />
    ) : field.settings.image ? (
      <span className="flex min-w-0 items-center gap-2">
        <RecordImage src={value as string} icon={object.icon as IconName | undefined} />
        {addressLink(value as string)}
      </span>
    ) : (
      addressLink(value as string)
    ),
  editor: editorFor('url', 'example.com'),
  settingsEditor: ({ value, onChange }) => (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <div className="text-xs font-medium">Show as a picture</div>
        <p className="text-xs text-muted-foreground">
          The link is a picture of the record, such as a logo or a photo. Tables draw it beside the name.
        </p>
      </div>
      <Switch
        aria-label="Show as a picture"
        checked={value.image === true}
        onCheckedChange={(checked) => onChange({ ...value, image: checked || undefined })}
      />
    </div>
  ),
  filter: { operators: opsForFieldType('url') },
  sortable: SORTABLE_FIELD_TYPES.has('url'),
  groupable: false,
  searchable: SEARCHABLE_FIELD_TYPES.has('url'),
  toText: (value) => value ?? '',
});
