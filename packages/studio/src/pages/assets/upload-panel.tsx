import { Button, Icon, Progress } from '@devias/ui';
import type { AssetUpload } from '../../hooks/use-assets';
import { formatBytes } from '../../lib/assets';

/** The files on their way: each with how far it got, and a way to stop it, try it again or put it away. */
export function UploadPanel({
  uploads,
  onCancel,
  onRetry,
  onDismiss,
}: {
  uploads: AssetUpload[];
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
  onDismiss: (id: number) => void;
}) {
  if (uploads.length === 0) {
    return null;
  }

  return (
    <ul data-slot="uploads" aria-label="Uploads" className="mx-4 mb-3 flex flex-col gap-2 sm:mx-6">
      {uploads.map((upload) => {
        const percent = upload.total > 0 ? Math.min(100, Math.round((upload.loaded / upload.total) * 100)) : 0;

        return (
          <li
            key={upload.id}
            data-status={upload.status}
            className="flex items-center gap-3 rounded-lg px-3 py-2 ring-1 ring-border/60 ring-inset"
          >
            <Icon
              name={upload.status === 'done' ? 'circle-check' : upload.status === 'error' ? 'circle-alert' : 'upload'}
              className={upload.status === 'error' ? 'size-4 text-destructive' : 'size-4 text-muted-foreground'}
            />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex items-baseline gap-2 text-xs">
                <span className="truncate font-medium">{upload.file.name}</span>
                <span className="shrink-0 text-muted-foreground">{formatBytes(upload.file.size)}</span>
              </span>
              {upload.status === 'error' ? (
                <span role="alert" className="text-xs text-destructive">
                  {upload.error}
                </span>
              ) : (
                <Progress
                  value={upload.status === 'done' ? 100 : percent}
                  aria-label={`Uploading ${upload.file.name}`}
                />
              )}
            </div>
            {upload.status === 'uploading' ? (
              <Button variant="ghost" size="sm" onClick={() => onCancel(upload.id)}>
                Cancel
              </Button>
            ) : null}
            {upload.status === 'error' ? (
              <>
                <Button variant="outline" size="sm" onClick={() => onRetry(upload.id)}>
                  Try again
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label="Dismiss" onClick={() => onDismiss(upload.id)}>
                  <Icon name="x" />
                </Button>
              </>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
