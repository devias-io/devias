import type { Asset } from '@devias/core';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Icon,
} from '@devias/ui';
import { useCopyAssetLink } from '../../hooks/use-assets';
import { downloadUrlOf, startDownload } from '../../lib/assets';

/** The ⋯ menu of an asset: open it, download it, copy a link that opens it, delete it. */
export function AssetMenu({
  asset,
  onOpen,
  onDelete,
  className,
}: {
  asset: Asset;
  onOpen: () => void;
  onDelete: () => void;
  className?: string;
}) {
  const copyLink = useCopyAssetLink();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Actions for ${asset.name}`}
            title="Actions"
            {...(className ? { className } : {})}
            onClick={(event) => event.stopPropagation()}
          />
        }
      >
        <Icon name="more-horizontal" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem onClick={onOpen}>
          <Icon name="eye" /> Open
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => startDownload(downloadUrlOf(asset), asset.name)}>
          <Icon name="download" /> Download
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void copyLink(asset.id)}>
          <Icon name="link" /> Copy link
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onDelete}>
          <Icon name="trash-2" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
