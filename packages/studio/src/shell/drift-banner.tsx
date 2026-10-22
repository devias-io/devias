import { hashManifest, type InstalledModule, type ModuleManifest } from '@devias/core';
import { Button, Icon } from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useClient } from '../providers/client';
import { useSchema } from '../providers/schema';
import { useStudioConfig } from '../providers/studio-config';
import { useWorkspace } from '../providers/workspace';
import { keys } from '../query/keys';
import { links } from '../router/links';
import { useNavigation } from '../router/navigation';

export interface ManifestDrift {
  manifest: ModuleManifest;
  hash: string;
  installedHash: string | undefined;
  status: 'installed' | 'update_available' | 'not_installed';
}

/** Compare a manifest with what the workspace has installed (by manifest hash). */
export const driftOf = (manifest: ModuleManifest, installedList: InstalledModule[]): ManifestDrift => {
  const hash = hashManifest(manifest);
  const installed = installedList.find((e) => e.moduleId === manifest.id);
  const status = !installed ? 'not_installed' : installed.manifestHash === hash ? 'installed' : 'update_available';

  return { manifest, hash, installedHash: installed?.manifestHash, status };
};

/** Compare compiled-in manifests with what the workspace has installed. */
export const useManifestDrift = (): ManifestDrift[] => {
  const config = useStudioConfig();
  const { schema } = useSchema();

  return useMemo(
    () => config.manifests.map((manifest) => driftOf(manifest, schema.modules)),
    [config.manifests, schema.modules],
  );
};

/**
 * Shown when a compiled-in manifest differs from the installed one. With `dev.autoApplyModules`, plans
 * without destructive changes or conflicts are applied automatically on boot. Modules that are not installed are
 * not drift: installing and uninstalling are the admin's call in Settings → Modules, so an uninstall sticks.
 */
export function DriftBanner() {
  const config = useStudioConfig();
  const client = useClient();
  const queryClient = useQueryClient();
  const { slug, isAdmin } = useWorkspace();
  const navigation = useNavigation();
  const drift = useManifestDrift();
  // Stable while the drift is, so the effect below does not run again just because it set `applying`.
  const pending = useMemo(() => drift.filter((d) => d.status === 'update_available'), [drift]);
  const attempted = useRef(new Set<string>());
  // How many rounds of applying are under way, so the strip goes only when the last one is done.
  const running = useRef(0);
  const [applying, setApplying] = useState(false);
  // What the strip says: it only checks what a module's plan comes to until there is something to apply.
  const [step, setStep] = useState<'checking' | 'applying'>('checking');
  const [needsReview, setNeedsReview] = useState<string[]>([]);
  // Whether the banner is still on screen: the one reason to skip updating its state once a round is over.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!config.dev.autoApplyModules || pending.length === 0) {
      return;
    }

    const todo = pending.filter((d) => !attempted.current.has(`${d.manifest.id}:${d.hash}`));

    if (todo.length === 0) {
      return;
    }

    for (const d of todo) {
      attempted.current.add(`${d.manifest.id}:${d.hash}`);
    }

    running.current += 1;
    setApplying(true);
    setStep('checking');
    void (async () => {
      const review: string[] = [];

      for (const d of todo) {
        try {
          const plan = await client.modules.plan(d.manifest);

          if (plan.hasDestructive || plan.hasConflicts) {
            review.push(d.manifest.id);
            continue;
          }

          if (plan.changes.every((c) => c.action === 'noop')) {
            continue;
          }

          if (mounted.current) {
            setStep('applying');
          }

          const result = await client.modules.apply(d.manifest, { expectedPlanHash: plan.planHash });
          toast.success(`Applied ${d.manifest.name} (${result.applied.length} changes)`);
        } catch (error) {
          review.push(d.manifest.id);
          toast.error(`Could not apply ${d.manifest.id}: ${error instanceof Error ? error.message : 'unknown error'}`);
        }
      }

      running.current -= 1;

      if (!mounted.current) {
        return;
      }

      setNeedsReview((before) => [...new Set([...before, ...review])]);

      if (running.current === 0) {
        setApplying(false);
      }

      await queryClient.invalidateQueries({ queryKey: keys.schema(client.workspaceId) });
      await queryClient.invalidateQueries({ queryKey: keys.modules(client.workspaceId) });
    })();
  }, [config.dev.autoApplyModules, pending, client, queryClient]);

  if (pending.length === 0) {
    return null;
  }

  if (config.dev.autoApplyModules && applying) {
    return (
      <div className="flex h-8 items-center gap-2 border-b border-border bg-muted/50 px-3 text-xs text-muted-foreground">
        <Icon name="loader-circle" className="size-3.5 animate-spin" />{' '}
        {step === 'applying' ? 'Applying module changes…' : 'Checking module changes…'}
      </div>
    );
  }

  // A module's own page says it itself, in the same strip: everywhere else, the list of modules included, this one does.
  if (navigation.pathname.startsWith(`${links.settings(slug, 'modules')}/`)) {
    return null;
  }

  const names = (needsReview.length > 0 ? pending.filter((d) => needsReview.includes(d.manifest.id)) : pending)
    .map((d) => d.manifest.name)
    .join(', ');

  return (
    <div className="flex h-8 items-center justify-center gap-3 bg-brand px-3 font-mono text-[12px] text-brand-foreground">
      <Icon name="flag" className="size-3.5 shrink-0 fill-current" />
      <span className="truncate">
        Module changes are pending for <span className="font-medium">{names}</span>.
      </span>
      {isAdmin ? (
        <Button
          size="xs"
          variant="link"
          className="h-auto p-0 font-mono text-[12px] font-medium text-brand-foreground underline"
          onClick={() => navigation.navigate(links.settings(slug, 'modules'))}
        >
          Review and apply
        </Button>
      ) : null}
    </div>
  );
}
