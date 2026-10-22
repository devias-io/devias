import { defineBlockComponent } from '@devias/core';
import { externalHref, useRecordPage, useUpdateRecord } from '@devias/studio';
import {
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Icon,
  Input,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@devias/ui';
import { useState } from 'react';
import { imagesOf, MAX_IMAGES, withCover, withImage, withoutImage } from '../../lib/images';
import { ids } from '../../manifest';

/** A picture filling its box; one that will not load shows a picture icon in its place. */
function Picture({ url, className }: { url: string; className?: string }) {
  const [broken, setBroken] = useState(false);

  if (broken) {
    return (
      <span className={cn('flex items-center justify-center bg-muted text-muted-foreground', className)}>
        <Icon name="image" className="size-5" />
      </span>
    );
  }

  return (
    <img
      src={externalHref(url)}
      alt=""
      loading="lazy"
      className={cn('bg-white object-contain', className)}
      onError={() => setBroken(true)}
    />
  );
}

/** One picture as a square tile that opens it larger; the cover is the big one. */
function Tile({ url, cover, onOpen }: { url: string; cover: boolean; onOpen: () => void }) {
  return (
    <li data-image={url} data-cover={cover ? '' : undefined}>
      <button
        type="button"
        aria-label={cover ? 'View cover image' : 'View image'}
        onClick={onOpen}
        className={cn(
          'block overflow-hidden rounded-xl border border-border outline-none transition-shadow',
          'hover:ring-2 hover:ring-ring/40 focus-visible:ring-2 focus-visible:ring-ring/60',
          cover ? 'size-40' : 'size-[4.75rem]',
        )}
      >
        <Picture url={url} className="size-full" />
      </button>
    </li>
  );
}

/** The tile that adds the next picture: a link pasted into a small popover, Enter adds it. */
function AddTile({ big, onAdd }: { big: boolean; onAdd: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const submit = () => {
    if (url.trim() === '') {
      return;
    }

    onAdd(url);
    setUrl('');
    setOpen(false);
  };

  return (
    <li>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label="Add an image"
          className={cn(
            'flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border text-xs text-muted-foreground outline-none transition-colors',
            'hover:border-foreground/30 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60',
            big ? 'h-24 w-40' : 'size-[4.75rem]',
          )}
        >
          <Icon name="plus" className="size-4" />
          {big ? 'Add an image' : null}
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <label className="text-xs text-muted-foreground" htmlFor="product-image-link">
            Link to a picture
          </label>
          <Input
            id="product-image-link"
            type="url"
            placeholder="https://"
            autoFocus
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                submit();
              }
            }}
          />
          <Button size="sm" className="self-end" disabled={url.trim() === ''} onClick={submit}>
            Add image
          </Button>
        </PopoverContent>
      </Popover>
    </li>
  );
}

/** A picture, large, with what can be done to it. */
function Viewer({
  url,
  cover,
  editable,
  onClose,
  onCover,
  onRemove,
}: {
  url: string | null;
  cover: boolean;
  editable: boolean;
  onClose: () => void;
  onCover: () => void;
  onRemove: () => void;
}) {
  return (
    <Dialog open={url !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{cover ? 'Cover image' : 'Image'}</DialogTitle>
        </DialogHeader>
        {url ? <Picture url={url} className="max-h-[60vh] w-full rounded-lg border border-border" /> : null}
        {editable ? (
          <DialogFooter>
            {cover ? null : (
              <Button variant="outline" onClick={onCover}>
                <Icon name="star" /> Make cover
              </Button>
            )}
            <Button variant="outline" onClick={onRemove}>
              <Icon name="trash-2" /> Remove
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A product's pictures: the cover large, the rest as small tiles beside it, and a tile at the end that adds the next one
 * (a pasted link; up to eight). A click on a picture opens it larger, where it can be made the cover or removed. The
 * links are the product's `images` field.
 */
export const productImagesBlock = defineBlockComponent({
  id: ids.blocks.product_images,
  label: 'Images',
  icon: 'image',
  surfaces: { record: { objectIds: [ids.objects.product], frame: false } },
  component: function ProductImages() {
    const { object, record, readOnly } = useRecordPage();
    const update = useUpdateRecord(object.nameSingular);
    const images = imagesOf(record.images);
    const [viewing, setViewing] = useState<string | null>(null);
    const editable = !readOnly;
    const index = viewing === null ? -1 : images.indexOf(viewing);
    const save = (next: string[]) =>
      update.mutate({ id: record.id, patch: { images: next.length === 0 ? null : next } });

    if (images.length === 0 && !editable) {
      return null;
    }

    const [cover, ...rest] = images;
    const add =
      editable && images.length < MAX_IMAGES ? (
        <AddTile big={images.length === 0} onAdd={(url) => save(withImage(images, url))} />
      ) : null;

    return (
      <>
        <ul className="flex flex-wrap items-start gap-2" data-slot="product-images">
          {cover ? <Tile url={cover} cover onOpen={() => setViewing(cover)} /> : null}
          {cover ? (
            <li className="min-w-0 flex-1">
              <ul className="flex flex-wrap gap-2">
                {rest.map((url) => (
                  <Tile key={url} url={url} cover={false} onOpen={() => setViewing(url)} />
                ))}
                {add}
              </ul>
            </li>
          ) : (
            add
          )}
        </ul>
        <Viewer
          url={viewing}
          cover={index === 0}
          editable={editable}
          onClose={() => setViewing(null)}
          onCover={() => {
            save(withCover(images, index));
            setViewing(null);
          }}
          onRemove={() => {
            save(withoutImage(images, index));
            setViewing(null);
          }}
        />
      </>
    );
  },
});
