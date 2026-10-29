import type { Asset } from '@devias/core';
import { formatBytes } from '../../lib/assets';
import { ago } from '../../lib/time';
import { AssetMenu } from './asset-menu';
import { AssetThumb } from './asset-thumb';

/** An asset as a tile: its picture or kind of file over its name, size and age. */
export function AssetCard({ asset, onOpen, onDelete }: { asset: Asset; onOpen: () => void; onDelete: () => void }) {
  return (
    <div
      data-slot="asset-card"
      className="group relative flex h-40 w-[8.25rem] flex-col overflow-hidden sm:h-52 sm:w-48 rounded-lg ring-1 ring-border/60 transition-colors ring-inset hover:bg-accent/40 focus-within:ring-2 focus-within:ring-ring/60"
    >
      <button
        type="button"
        aria-label={`Open ${asset.name}`}
        className="flex h-full flex-col text-left outline-none"
        onClick={onOpen}
      >
        <AssetThumb asset={asset} width={256} className="h-24 w-full shrink-0 sm:h-36" />
        <span className="flex h-16 flex-col justify-center gap-0.5 border-t border-border/60 px-3">
          <span className="truncate text-xs font-medium" title={asset.name}>
            {asset.name}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {formatBytes(asset.size)} · {ago(asset.updatedAt)}
          </span>
        </span>
      </button>
      <AssetMenu
        asset={asset}
        onOpen={onOpen}
        onDelete={onDelete}
        className="absolute top-1.5 right-1.5 bg-background/80 backdrop-blur-sm group-focus-within:opacity-100 data-popup-open:opacity-100 pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100"
      />
    </div>
  );
}

/** An asset as a row: a small picture, its name, what kind of file it is, its size and age. */
export function AssetRow({
  asset,
  kind,
  onOpen,
  onDelete,
}: {
  asset: Asset;
  kind: string;
  onOpen: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      data-slot="asset-row"
      className="group flex items-center gap-3 border-b border-border/60 px-2 py-1.5 transition-colors last:border-b-0 hover:bg-accent/40"
    >
      <button
        type="button"
        aria-label={`Open ${asset.name}`}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/60"
        onClick={onOpen}
      >
        <AssetThumb asset={asset} width={64} className="size-9 shrink-0 rounded-md" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium" title={asset.name}>
          {asset.name}
        </span>
        <span className="hidden w-20 shrink-0 text-xs text-muted-foreground sm:block">{kind}</span>
        <span className="hidden w-20 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:block">
          {formatBytes(asset.size)}
        </span>
        <span className="hidden w-28 shrink-0 text-right text-xs text-muted-foreground md:block">
          {ago(asset.updatedAt)}
        </span>
      </button>
      <AssetMenu asset={asset} onOpen={onOpen} onDelete={onDelete} />
    </div>
  );
}
