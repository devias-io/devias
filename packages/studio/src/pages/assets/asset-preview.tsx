import { type Asset, assetGroupOf } from '@devias/core';
import { Icon, Skeleton } from '@devias/ui';
import { useQuery } from '@tanstack/react-query';
import { assetKindOf, thumbnailOf } from '../../lib/assets';

/** Text this small is shown; a bigger file is a download. */
const TEXT_PREVIEW_MAX_BYTES = 200 * 1024;

function TextPreview({ asset }: { asset: Asset }) {
  const text = useQuery({
    queryKey: ['asset-text', asset.id, asset.checksum],
    queryFn: async () => {
      const response = await fetch(asset.url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.text();
    },
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

  if (text.isPending) {
    return <Skeleton className="h-40 w-full" />;
  }

  if (text.isError) {
    return <p className="text-xs text-muted-foreground">The text could not be loaded.</p>;
  }

  return (
    <pre
      data-slot="asset-text"
      className="max-h-80 w-full overflow-auto rounded-md bg-accent/40 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap"
    >
      {text.data}
    </pre>
  );
}

/** What an asset looks like opened: the picture, the PDF in a viewer, the text; for anything else its kind and a way to download. */
export function AssetPreview({ asset }: { asset: Asset }) {
  const group = assetGroupOf(asset.contentType);

  if (group === 'image') {
    return (
      <div className="flex justify-center rounded-md bg-accent/40 p-2" data-slot="asset-preview">
        <img
          src={thumbnailOf(asset, 1024, 'inside') ?? asset.url}
          alt={asset.name}
          className="max-h-80 max-w-full rounded object-contain"
        />
      </div>
    );
  }

  if (group === 'pdf') {
    return (
      <iframe
        data-slot="asset-preview"
        title={asset.name}
        src={asset.url}
        className="h-96 w-full rounded-md border border-border/60 bg-background"
      />
    );
  }

  if (group === 'text' && asset.size <= TEXT_PREVIEW_MAX_BYTES) {
    return <TextPreview asset={asset} />;
  }

  const kind = assetKindOf(asset.contentType);

  return (
    <div
      data-slot="asset-preview"
      className="flex h-40 flex-col items-center justify-center gap-2 rounded-md bg-accent/40 text-muted-foreground"
    >
      <Icon name={kind.icon} className="size-8" />
      <span className="text-xs">No preview for this file</span>
    </div>
  );
}
