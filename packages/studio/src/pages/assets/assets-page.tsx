import { ASSET_TYPE_GROUPS, type Asset, type AssetTypeGroup } from '@devias/core';
import { Button, EmptyState, Icon, Page, PageHeader, Skeleton, ToggleGroup, ToggleGroupItem } from '@devias/ui';
import { useEffect, useRef, useState } from 'react';
import { ConfirmDeleteDialog } from '../../components/confirm-delete-dialog';
import { SearchInput } from '../../components/search-input';
import { placesUsing, useAssets, useAssetsUsage, useAssetUploads, useDeleteAsset } from '../../hooks/use-assets';
import { useEndlessScroll } from '../../hooks/use-endless-scroll';
import { assetKindOf, formatBytes } from '../../lib/assets';
import { remember, remembered } from '../../lib/remembered';
import { useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { AssetCard, AssetRow } from './asset-card';
import { AssetSheet } from './asset-sheet';
import { UploadPanel } from './upload-panel';

/**
 * Tiles have one size per screen class, whatever the window: more or fewer of them fit in a row, none of them stretches or
 * reflows. Small screens get smaller tiles (two to a row from a 360 px phone up); on every screen they start at the left.
 */
const GRID =
  'grid grid-cols-[repeat(auto-fill,8.25rem)] justify-start gap-2 px-4 pt-1 pb-8 sm:grid-cols-[repeat(auto-fill,12rem)] sm:gap-4 sm:px-6';
const VIEW_KEY = 'devias.studio.assets.view';

type View = 'grid' | 'list';
type TypeFilter = AssetTypeGroup | 'all';

const TYPE_LABELS: Record<TypeFilter, string> = {
  all: 'All',
  image: 'Images',
  pdf: 'PDFs',
  text: 'Text',
  other: 'Other',
};

const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');

/** The workspace's assets: pictures and files to look through, search, open, download and delete, and a place to drop new ones. */
export function AssetsPage() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState<TypeFilter>('all');
  const [view, setView] = useState<View>(() => remembered<View>(VIEW_KEY, ['grid', 'list'], 'grid'));
  const [openId, setOpenId] = useState<string | null>(null);
  const [doomed, setDoomed] = useState<Asset | null>(null);
  // An asset that is in use, and how many places use it, once a delete was refused: asked again before it is forced.
  const [stillUsed, setStillUsed] = useState<{ asset: Asset; places: number } | null>(null);
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const linked = typeof navigation.search.asset === 'string' ? navigation.search.asset : null;
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const filters = { ...(search ? { search } : {}), ...(type === 'all' ? {} : { type }) };
  const query = useAssets(filters);
  const usage = useAssetsUsage();
  const uploads = useAssetUploads();
  const remove = useDeleteAsset();
  const assets = query.data?.pages.flatMap((page) => page.items) ?? [];
  const sentinel = useEndlessScroll(query);
  const filtered = search !== '' || type !== 'all';

  // A link to an asset (`asset:<id>`, from a document, a task or a message) opens it here.
  useEffect(() => {
    if (linked) {
      setOpenId(linked);
    }
  }, [linked]);

  const close = () => {
    setOpenId(null);

    if (linked) {
      navigation.navigate(links.assets(slug));
    }
  };
  const choose = () => picker.current?.click();
  const summary = usage.data
    ? `${usage.data.count} ${usage.data.count === 1 ? 'asset' : 'assets'} · ${formatBytes(usage.data.bytes)}${
        usage.data.quotaBytes ? ` of ${formatBytes(usage.data.quotaBytes)}` : ''
      }`
    : null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; the button above does the same for the keyboard
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      data-slot="assets-page"
      onDragEnter={(event) => {
        if (hasFiles(event)) {
          dragDepth.current += 1;
          setDragging(true);
        }
      }}
      onDragOver={(event) => hasFiles(event) && event.preventDefault()}
      onDragLeave={(event) => {
        if (hasFiles(event)) {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          setDragging(dragDepth.current > 0);
        }
      }}
      onDrop={(event) => {
        dragDepth.current = 0;
        setDragging(false);

        if (hasFiles(event)) {
          event.preventDefault();
          uploads.add(Array.from(event.dataTransfer.files));
        }
      }}
    >
      <Page fullBleed>
        <div className="px-4 pt-4">
          <PageHeader
            title="Assets"
            description={summary ?? 'The files your workspace keeps.'}
            actions={
              <Button onClick={choose}>
                <Icon name="upload" /> Upload
              </Button>
            }
          />
        </div>
        <div data-slot="assets-toolbar" className="flex flex-wrap items-center gap-2 px-4 pb-3 sm:px-6">
          <div className="max-w-full min-w-0 overflow-x-auto">
            <ToggleGroup
              variant="outline"
              size="sm"
              aria-label="Type"
              value={[type]}
              onValueChange={(next) => {
                const chosen = next[0] as TypeFilter | undefined;

                if (chosen) {
                  setType(chosen);
                }
              }}
            >
              {(['all', ...ASSET_TYPE_GROUPS] as const).map((group) => (
                <ToggleGroupItem key={group} value={group} aria-label={TYPE_LABELS[group]}>
                  {TYPE_LABELS[group]}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <SearchInput label="Search assets" value={search} onChange={setSearch} />
            <ToggleGroup
              variant="outline"
              size="sm"
              aria-label="View"
              value={[view]}
              onValueChange={(next) => {
                const chosen = next[0] as View | undefined;

                if (chosen) {
                  setView(chosen);
                  remember(VIEW_KEY, chosen);
                }
              }}
            >
              <ToggleGroupItem value="grid" aria-label="Grid">
                <Icon name="layout-grid" />
              </ToggleGroupItem>
              <ToggleGroupItem value="list" aria-label="List">
                <Icon name="list" />
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </div>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          aria-label="Choose files to upload"
          onChange={(event) => {
            uploads.add(Array.from(event.target.files ?? []));
            event.target.value = '';
          }}
        />
        <UploadPanel
          uploads={uploads.uploads}
          onCancel={uploads.cancel}
          onRetry={uploads.retry}
          onDismiss={uploads.dismiss}
        />
        {query.isPending ? (
          <div className={GRID}>
            {Array.from({ length: 8 }, (_, i) => (
              <Skeleton key={i} className="h-40 w-[8.25rem] rounded-lg sm:h-52 sm:w-48" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <EmptyState
            icon="folder"
            title={filtered ? 'No assets match' : 'No assets yet'}
            description={
              filtered ? 'Try another word, or clear the filters.' : 'Upload a file, or drop one anywhere on this page.'
            }
            action={
              filtered ? undefined : (
                <Button size="lg" onClick={choose}>
                  <Icon name="upload" /> Upload
                </Button>
              )
            }
          />
        ) : (
          <div className="h-full overflow-y-auto [scrollbar-gutter:stable]" data-slot="assets">
            {view === 'grid' ? (
              <div className={GRID}>
                {assets.map((asset) => (
                  <AssetCard
                    key={asset.id}
                    asset={asset}
                    onOpen={() => setOpenId(asset.id)}
                    onDelete={() => setDoomed(asset)}
                  />
                ))}
              </div>
            ) : (
              <div className="mx-4 mb-8 rounded-lg ring-1 ring-border/60 ring-inset sm:mx-6">
                {assets.map((asset) => (
                  <AssetRow
                    key={asset.id}
                    asset={asset}
                    kind={assetKindOf(asset.contentType).label}
                    onOpen={() => setOpenId(asset.id)}
                    onDelete={() => setDoomed(asset)}
                  />
                ))}
              </div>
            )}
            {query.hasNextPage ? <div ref={sentinel} className="h-8" /> : null}
          </div>
        )}
      </Page>
      {dragging ? (
        <div
          data-slot="drop-overlay"
          className="pointer-events-none absolute inset-2 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-ring bg-background/80 text-sm font-medium backdrop-blur-sm"
        >
          Drop to upload
        </div>
      ) : null}
      <AssetSheet id={openId} onClose={close} onDelete={setDoomed} />
      <ConfirmDeleteDialog
        noun="asset"
        description={doomed ? `“${doomed.name}” is removed from the workspace.` : ''}
        open={doomed !== null}
        onOpenChange={(open) => !open && setDoomed(null)}
        onConfirm={() => {
          if (doomed) {
            const asset = doomed;
            remove.mutate(
              { id: asset.id },
              {
                onSuccess: () => openId === asset.id && close(),
                onError: (error) => {
                  const places = placesUsing(error);

                  if (places !== null) {
                    setStillUsed({ asset, places });
                  }
                },
              },
            );
          }

          setDoomed(null);
        }}
      />
      <ConfirmDeleteDialog
        noun="asset"
        description={
          stillUsed
            ? `“${stillUsed.asset.name}” is used in ${stillUsed.places} ${stillUsed.places === 1 ? 'place' : 'places'}, which will show “File removed”.`
            : ''
        }
        open={stillUsed !== null}
        onOpenChange={(open) => !open && setStillUsed(null)}
        onConfirm={() => {
          if (stillUsed) {
            const { asset } = stillUsed;
            remove.mutate({ id: asset.id, force: true }, { onSuccess: () => openId === asset.id && close() });
          }

          setStillUsed(null);
        }}
      />
    </div>
  );
}
