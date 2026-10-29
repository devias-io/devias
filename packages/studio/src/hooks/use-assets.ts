import {
  ASSETS_DEFAULT_LIMIT,
  type Asset,
  type AssetPatch,
  type AssetQuery,
  type AssetsUsage,
  type AssetUsage,
  DeviasApiError,
} from '@devias/core';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { keys } from '../query/keys';
import { errorMessage } from './use-mutations';

/** Assets, newest change first, a page at a time; kept fresh by live updates. */
export const useAssets = (query: Pick<AssetQuery, 'search' | 'type'> = {}, pageSize = ASSETS_DEFAULT_LIMIT) => {
  const client = useClient();

  return useInfiniteQuery({
    queryKey: keys.assetList(client.workspaceId, { ...query, pageSize }),
    queryFn: ({ pageParam }) =>
      client.assets.list({ ...query, limit: pageSize, ...(pageParam ? { cursor: pageParam } : {}) }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
};

/** One asset, with a link that opens it. */
export const useAsset = (id: string | null) => {
  const client = useClient();

  return useQuery({
    queryKey: keys.asset(client.workspaceId, id ?? ''),
    queryFn: () => client.assets.get(id ?? ''),
    enabled: id !== null,
    retry: false,
  });
};

/** What the workspace stores. */
export const useAssetsUsage = () => {
  const client = useClient();

  return useQuery<AssetsUsage>({
    queryKey: keys.assetUsage(client.workspaceId),
    queryFn: () => client.assets.workspaceUsage(),
  });
};

/** Rename or describe an asset. A conflict (someone else changed it first) is the caller's to handle. */
export const useUpdateAsset = (id: string) => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: AssetPatch) => client.assets.update(id, patch),
    onSuccess: (asset: Asset) => {
      queryClient.setQueryData(keys.asset(client.workspaceId, id), asset);
      void queryClient.invalidateQueries({ queryKey: [...keys.assets(client.workspaceId), 'list'] });
    },
  });
};

/** Where an asset is used: the documents and tasks that mention it or are about it. */
export const useAssetUsage = (id: string | null) => {
  const client = useClient();

  return useQuery<AssetUsage>({
    queryKey: [...keys.assets(client.workspaceId), 'usage', id ?? ''],
    queryFn: () => client.assets.usage(id ?? ''),
    enabled: id !== null,
  });
};

/** How many places refused to let go of an asset, from the error of a delete that was refused; null for any other error. */
export const placesUsing = (error: unknown): number | null => {
  if (!(error instanceof DeviasApiError) || error.code !== 'CONFLICT') {
    return null;
  }

  const total = (error.details as { usage?: { total?: unknown } } | undefined)?.usage?.total;

  return typeof total === 'number' ? total : null;
};

/**
 * Delete an asset. One that is in use is refused: that is the caller's to ask about (`placesUsing`), then to delete again
 * with `force`, so nothing is toasted for it.
 */
export const useDeleteAsset = () => {
  const client = useClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, force }: { id: string; force?: boolean }) =>
      client.assets.delete(id, force ? { force: true } : undefined),
    onSuccess: () => {
      toast.success('Asset deleted');
      void queryClient.invalidateQueries({ queryKey: keys.assets(client.workspaceId) });
    },
    onError: (error) => {
      if (placesUsing(error) === null) {
        toast.error(errorMessage(error));
      }
    },
  });
};

/** A link that opens the asset without signing in, copied to the clipboard. */
export const useCopyAssetLink = () => {
  const client = useClient();

  return useCallback(
    async (id: string) => {
      try {
        const { url } = await client.assets.link(id);
        await navigator.clipboard.writeText(url);
        toast.success('Link copied. It opens the file for 10 minutes.');
      } catch (error) {
        toast.error(errorMessage(error));
      }
    },
    [client],
  );
};

/** A file on its way to the library. */
export interface AssetUpload {
  id: number;
  file: File;
  /** Bytes sent so far, and in all. */
  loaded: number;
  total: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

const DONE_VISIBLE_MS = 2500;

/** Files being uploaded: each with its progress, cancelled or tried again, and the library refreshed as they land. */
export const useAssetUploads = () => {
  const client = useClient();
  const queryClient = useQueryClient();
  const [uploads, setUploads] = useState<AssetUpload[]>([]);
  const controllers = useRef(new Map<number, AbortController>());
  const next = useRef(1);

  const change = useCallback((id: number, patch: Partial<AssetUpload>) => {
    setUploads((list) => list.map((upload) => (upload.id === id ? { ...upload, ...patch } : upload)));
  }, []);
  const drop = useCallback((id: number) => {
    setUploads((list) => list.filter((upload) => upload.id !== id));
  }, []);

  const send = useCallback(
    async (upload: AssetUpload) => {
      const controller = new AbortController();
      controllers.current.set(upload.id, controller);
      change(upload.id, { status: 'uploading', loaded: 0, total: upload.file.size, error: undefined as never });

      try {
        await client.assets.upload(
          { name: upload.file.name, body: upload.file },
          {
            signal: controller.signal,
            onProgress: ({ loaded, total }) => change(upload.id, { loaded, total: total || upload.file.size }),
          },
        );
        change(upload.id, { status: 'done', loaded: upload.file.size, total: upload.file.size });
        void queryClient.invalidateQueries({ queryKey: keys.assets(client.workspaceId) });
        setTimeout(() => drop(upload.id), DONE_VISIBLE_MS);
      } catch (error) {
        if (controller.signal.aborted || (error as { name?: string }).name === 'AbortError') {
          drop(upload.id);
        } else {
          change(upload.id, {
            status: 'error',
            error: error instanceof DeviasApiError ? error.message : errorMessage(error),
          });
        }
      } finally {
        controllers.current.delete(upload.id);
      }
    },
    [client, queryClient, change, drop],
  );

  const add = useCallback(
    (files: File[]) => {
      const added = files.map(
        (file): AssetUpload => ({ id: next.current++, file, loaded: 0, total: file.size, status: 'uploading' }),
      );
      setUploads((list) => [...list, ...added]);

      for (const upload of added) {
        void send(upload);
      }
    },
    [send],
  );

  return {
    uploads,
    add,
    cancel: useCallback((id: number) => controllers.current.get(id)?.abort(), []),
    retry: useCallback(
      (id: number) => {
        const upload = uploads.find((candidate) => candidate.id === id);

        if (upload) {
          void send(upload);
        }
      },
      [uploads, send],
    ),
    dismiss: drop,
  };
};
