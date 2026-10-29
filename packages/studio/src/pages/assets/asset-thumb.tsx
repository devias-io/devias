import type { Asset } from '@devias/core';
import { Icon } from '@devias/ui';
import { useState } from 'react';
import { assetKindOf, extensionOf, thumbnailOf } from '../../lib/assets';

/** What an asset looks like in a tile: a thumbnail for pictures, the kind of file (its icon and extension) for the rest. */
export function AssetThumb({
  asset,
  width,
  className,
}: {
  asset: Pick<Asset, 'name' | 'url' | 'contentType'>;
  /** The size of the thumbnail the server is asked for; a tile this wide or smaller looks sharp. */
  width: 64 | 128 | 256 | 512;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = failed ? null : thumbnailOf(asset, width);
  const kind = assetKindOf(asset.contentType);
  const extension = extensionOf(asset.name);

  return (
    <div
      data-slot="asset-thumb"
      className={`flex items-center justify-center overflow-hidden bg-accent/40 text-muted-foreground ${className ?? ''}`}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          draggable={false}
          className="size-full object-cover"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="flex flex-col items-center gap-1">
          <Icon name={kind.icon} className="size-1/3 min-h-4 min-w-4" />
          {extension ? <span className="text-[0.625rem] font-medium tracking-wide">{extension}</span> : null}
        </span>
      )}
    </div>
  );
}
