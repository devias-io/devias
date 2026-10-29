import { type Asset, DeviasApiError } from '@devias/core';
import {
  Button,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Skeleton,
  Textarea,
} from '@devias/ui';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { EntityLink } from '../../components/entity-link';
import { useAsset, useAssetUsage, useCopyAssetLink, useUpdateAsset } from '../../hooks/use-assets';
import { assetKindOf, downloadUrlOf, formatBytes, startDownload } from '../../lib/assets';
import { ago } from '../../lib/time';
import { ActorName, fullDate, useActors } from '../../record/activity/shared';
import { AssetPreview } from './asset-preview';

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-xs">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

/** The name and the description of an asset, saved when the field is left. */
function AssetForm({ asset }: { asset: Asset }) {
  const update = useUpdateAsset(asset.id);
  const nameId = useId();
  const descriptionId = useId();
  const [name, setName] = useState(asset.name);
  const [description, setDescription] = useState(asset.description);

  const save = (patch: { name?: string; description?: string }) => {
    update.mutate(
      { ...patch, expectedVersion: asset.version },
      {
        onError: (error) => {
          // Back to what is saved, and say why.
          setName(asset.name);
          setDescription(asset.description);
          toast.error(
            error instanceof DeviasApiError && error.code === 'CONFLICT'
              ? 'Someone else changed this asset. It was reloaded.'
              : error instanceof Error
                ? error.message
                : 'Could not save',
          );
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 text-xs font-medium">
        <label htmlFor={nameId}>Name</label>
        <Input
          id={nameId}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const next = name.trim();

            if (next === '') {
              setName(asset.name);
            } else if (next !== asset.name) {
              save({ name: next });
            }
          }}
          onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
        />
      </div>
      <div className="flex flex-col gap-1.5 text-xs font-medium">
        <label htmlFor={descriptionId}>Description</label>
        <Textarea
          id={descriptionId}
          value={description}
          placeholder="What is this file for?"
          rows={3}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => description !== asset.description && save({ description })}
        />
      </div>
    </div>
  );
}

/** The documents and tasks that mention an asset or are about it, each a link to it. */
function UsedIn({ id }: { id: string }) {
  const usage = useAssetUsage(id);
  const places = usage.data?.mentions ?? [];

  return (
    <div data-slot="asset-usage" className="flex flex-col gap-2 border-t border-border/60 pt-3">
      <h3 className="text-xs font-medium">Used in</h3>
      {usage.isPending ? (
        <Skeleton className="h-6 w-2/3" />
      ) : places.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing links to this asset yet.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {places.map((place) => (
            <li key={`${place.kind}:${place.id}:${place.role}`} className="flex items-center gap-2">
              <EntityLink link={`${place.kind}:${place.id}`} />
              {place.role === 'about' ? <span className="text-xs text-muted-foreground">is about it</span> : null}
            </li>
          ))}
          {usage.data && usage.data.total > places.length ? (
            <li className="text-xs text-muted-foreground">and {usage.data.total - places.length} more</li>
          ) : null}
        </ul>
      )}
    </div>
  );
}

function AssetDetails({ asset, onDelete }: { asset: Asset; onDelete: (asset: Asset) => void }) {
  const actors = useActors();
  const copyLink = useCopyAssetLink();
  const kind = assetKindOf(asset.contentType);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
      <AssetPreview asset={asset} />
      <AssetForm key={`${asset.id}:${asset.version}`} asset={asset} />
      <UsedIn id={asset.id} />
      <dl className="flex flex-col gap-1.5 border-t border-border/60 pt-3">
        <Meta label="Type">
          {kind.label} <span className="text-muted-foreground">({asset.contentType})</span>
        </Meta>
        <Meta label="Size">{formatBytes(asset.size)}</Meta>
        {asset.width && asset.height ? (
          <Meta label="Dimensions">
            {asset.width} × {asset.height}
          </Meta>
        ) : null}
        <Meta label="Added">
          <time dateTime={asset.createdAt} title={fullDate(new Date(asset.createdAt))}>
            {ago(asset.createdAt)}
          </time>{' '}
          by <ActorName person={actors(asset.createdBy)} />
        </Meta>
        {asset.updatedAt !== asset.createdAt ? (
          <Meta label="Changed">
            <time dateTime={asset.updatedAt} title={fullDate(new Date(asset.updatedAt))}>
              {ago(asset.updatedAt)}
            </time>
          </Meta>
        ) : null}
      </dl>
      <div className="mt-auto flex flex-wrap gap-2 border-t border-border/60 pt-3">
        <Button variant="outline" size="sm" onClick={() => startDownload(downloadUrlOf(asset), asset.name)}>
          Download
        </Button>
        <Button variant="outline" size="sm" onClick={() => void copyLink(asset.id)}>
          Copy link
        </Button>
        <Button variant="outline" size="sm" className="ml-auto text-destructive" onClick={() => onDelete(asset)}>
          Delete
        </Button>
      </div>
    </div>
  );
}

/** The side panel of one asset: what it looks like, its name and description, who added it, and what can be done with it. */
export function AssetSheet({
  id,
  onClose,
  onDelete,
}: {
  id: string | null;
  onClose: () => void;
  onDelete: (asset: Asset) => void;
}) {
  const query = useAsset(id);
  const asset = query.data;

  return (
    <Sheet open={id !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="gap-3 data-[side=right]:w-full" data-slot="asset-sheet">
        <SheetHeader className="pr-12">
          <SheetTitle className="truncate">{asset?.name ?? 'Asset'}</SheetTitle>
          <SheetDescription>{asset ? assetKindOf(asset.contentType).label : 'Loading…'}</SheetDescription>
        </SheetHeader>
        {asset ? (
          <AssetDetails asset={asset} onDelete={onDelete} />
        ) : query.isError ? (
          <p className="px-4 text-xs text-muted-foreground">This asset is no longer there.</p>
        ) : (
          <div className="flex flex-col gap-3 px-4">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
