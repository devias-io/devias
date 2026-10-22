import { type ApiKeySummary, defineSettingsSection } from '@devias/core';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Field,
  FieldGroup,
  FieldLabel,
  Icon,
  Input,
  OptionSelect,
  Section,
  Skeleton,
  TABLE_CELL,
  TABLE_HEAD,
  TABLE_ROW,
} from '@devias/ui';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../../hooks/use-mutations';
import { useAuth } from '../../../providers/auth';
import { useWorkspace } from '../../../providers/workspace';
import { keys } from '../../../query/keys';

function ApiKeysSettings() {
  const auth = useAuth();
  const { organization } = useWorkspace();
  const queryClient = useQueryClient();
  const api = auth.apiKeys;
  const list = useQuery({
    queryKey: keys.apiKeys(organization.id),
    queryFn: () => (api as NonNullable<typeof api>).list(organization.id),
    enabled: Boolean(api),
  });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [expires, setExpires] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<(ApiKeySummary & { key: string }) | null>(null);
  const [revoking, setRevoking] = useState<ApiKeySummary | null>(null);

  if (!api) {
    return (
      <EmptyState
        icon="key"
        title="API keys are not available"
        description="The configured auth adapter does not manage API keys."
      />
    );
  }

  const create = async () => {
    setBusy(true);

    try {
      const result = await api.create(organization.id, {
        name: name.trim(),
        ...(expires ? { expiresInDays: Number(expires) } : {}),
      });
      setCreating(false);
      setName('');
      setCreated(result);
      await queryClient.invalidateQueries({ queryKey: keys.apiKeys(organization.id) });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (key: ApiKeySummary) => {
    try {
      await api.delete(organization.id, key.id);
      await queryClient.invalidateQueries({ queryKey: keys.apiKeys(organization.id) });
      toast.success('API key revoked');
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Could not copy; select the key and copy it manually');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Section
        title="API keys"
        description="Send a key as the x-api-key header to call the API without a session."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Icon name="plus" className="size-3.5" /> New key
          </Button>
        }
      >
        {list.isPending ? (
          <Skeleton className="h-8 w-full" />
        ) : list.isError ? (
          <div className="text-xs text-destructive">{errorMessage(list.error)}</div>
        ) : (list.data ?? []).length === 0 ? (
          <div className="text-xs text-muted-foreground">No API keys yet.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className={TABLE_ROW}>
                <th className={TABLE_HEAD}>Name</th>
                <th className={TABLE_HEAD}>Key</th>
                <th className={TABLE_HEAD}>Created</th>
                <th className={TABLE_HEAD}>Expires</th>
                <th className={cn(TABLE_HEAD, 'w-20')} />
              </tr>
            </thead>
            <tbody>
              {(list.data ?? []).map((key) => (
                <tr key={key.id} className={TABLE_ROW}>
                  <td className={cn(TABLE_CELL, 'font-medium')}>{key.name ?? 'Untitled'}</td>
                  <td className={cn(TABLE_CELL, 'font-mono text-xs text-muted-foreground')}>
                    {key.start ?? key.prefix ?? '••••'}…
                  </td>
                  <td className={cn(TABLE_CELL, 'text-xs text-muted-foreground')}>
                    {new Date(key.createdAt).toLocaleDateString()}
                  </td>
                  <td className={cn(TABLE_CELL, 'text-xs text-muted-foreground')}>
                    {key.expiresAt ? new Date(key.expiresAt).toLocaleDateString() : 'Never'}
                  </td>
                  <td className={cn(TABLE_CELL, 'text-right')}>
                    <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setRevoking(key)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New API key</DialogTitle>
            <DialogDescription>The key is shown once after creation.</DialogDescription>
          </DialogHeader>
          <FieldGroup className="gap-3">
            <Field>
              <FieldLabel htmlFor="api-key-name">Name</FieldLabel>
              <Input
                id="api-key-name"
                placeholder="CI deploy"
                value={name}
                autoFocus
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="api-key-expires">Expires</FieldLabel>
              <OptionSelect
                id="api-key-expires"
                className="w-full"
                value={expires}
                onValueChange={setExpires}
                options={[
                  { value: '', label: 'Never' },
                  { value: '30', label: 'In 30 days' },
                  { value: '90', label: 'In 90 days' },
                  { value: '365', label: 'In a year' },
                ]}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreating(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !name.trim()} onClick={() => void create()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(created)} onOpenChange={(open) => !open && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Copy your API key</DialogTitle>
            <DialogDescription>Store it somewhere safe; it will not be shown again.</DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input
              readOnly
              value={created?.key ?? ''}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Copy key"
              onClick={() => created && void copy(created.key)}
            >
              <Icon name="copy" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(revoking)} onOpenChange={(open) => !open && setRevoking(null)}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke "{revoking?.name ?? 'this key'}"?</AlertDialogTitle>
            <AlertDialogDescription>Requests using it will start failing immediately.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                const key = revoking;
                setRevoking(null);

                if (key) {
                  void revoke(key);
                }
              }}
            >
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export const apiKeysSection = defineSettingsSection({
  name: 'api-keys',
  label: 'API keys',
  icon: 'key',
  group: 'developer',
  requiresRole: 'admin',
  component: ApiKeysSettings,
});
