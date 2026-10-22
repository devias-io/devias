import { defineFieldType } from '@devias/core';
import { RecordImage } from '@devias/studio';
import { Button, Icon, Input } from '@devias/ui';
import { useState } from 'react';
import { imagesOf, MAX_IMAGES, withImage, withoutImage } from '../../lib/images';

declare module '@devias/core' {
  interface FieldValueMap {
    images: string[];
  }
}

/** The pictures side by side, the first three and how many more there are. */
function Thumbnails({ value }: { value: unknown }) {
  const images = imagesOf(value);

  if (images.length === 0) {
    return (
      <span data-slot="empty-value" className="text-muted-foreground">
        -
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1" data-slot="images">
      {images.slice(0, 3).map((url) => (
        <RecordImage key={url} src={url} icon="image" />
      ))}
      {images.length > 3 ? <span className="text-xs text-muted-foreground">+{images.length - 3}</span> : null}
    </span>
  );
}

/** The links one under the other, each with a button to remove it, and a box to add the next. */
function ImagesEditor({
  value,
  onChange,
  mode,
  onCommit,
  onCancel,
  autoFocus,
  disabled,
}: {
  value: string[] | null;
  onChange: (value: string[] | null) => void;
  mode: 'form' | 'inline';
  onCommit?: () => void;
  onCancel?: () => void;
  autoFocus?: boolean;
  disabled?: boolean;
}) {
  const images = imagesOf(value);
  const [draft, setDraft] = useState('');
  const add = () => {
    const next = withImage(images, draft);

    if (next !== images) {
      onChange(next);
    }

    setDraft('');
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Escape cancels the inline editor; focus leaving it commits
    <div
      className="flex flex-col gap-1"
      onBlur={(event) => {
        if (mode === 'inline' && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
          onCommit?.();
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onCancel?.();
        }
      }}
    >
      {images.map((url, index) => (
        <div key={url} className="flex items-center gap-2">
          <RecordImage src={url} icon="image" />
          <span className="min-w-0 flex-1 truncate text-xs">{url}</span>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Remove image"
            disabled={disabled}
            onClick={() => onChange(withoutImage(images, index).length === 0 ? null : withoutImage(images, index))}
          >
            <Icon name="x" />
          </Button>
        </div>
      ))}
      {images.length < MAX_IMAGES ? (
        <Input
          aria-label="Add an image"
          type="url"
          placeholder="Paste a link to a picture"
          className={mode === 'inline' ? 'h-7' : undefined}
          value={draft}
          autoFocus={autoFocus}
          disabled={disabled}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={add}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              add();
            }
          }}
        />
      ) : null}
    </div>
  );
}

/** A list of picture links, the first being the cover. Stored as a JSON list of strings, so the API and the agent set it as one. */
export const imagesFieldType = defineFieldType<string[], Record<string, never>>({
  type: 'images',
  label: 'Images',
  icon: 'image',
  category: 'basic',
  cell: ({ value }) => <Thumbnails value={value} />,
  editor: ImagesEditor,
  filter: { operators: ['is_empty', 'is_not_empty'] },
  sortable: false,
  groupable: false,
  searchable: false,
  toText: (value) => imagesOf(value).join(', '),
});
