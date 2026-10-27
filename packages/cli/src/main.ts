import { createInterface } from 'node:readline/promises';
import { DeviasApiError, type ModuleManifest } from '@devias/core';
import { createClient } from '@devias/sdk';
import { Command } from 'commander';
import pc from 'picocolors';
import { loadManifest } from './load-manifest';
import { newIds } from './new-ids';
import { renderPlan } from './render';

interface ConnectionOptions {
  url: string;
  workspace: string;
  apiKey?: string;
}

const connect = (opts: ConnectionOptions) => {
  const apiKey = opts.apiKey ?? process.env.DEVIAS_API_KEY;

  if (!apiKey) {
    throw new Error('An API key is required: pass --api-key or set DEVIAS_API_KEY');
  }

  return createClient({ baseUrl: opts.url, workspaceId: opts.workspace, apiKey });
};

const confirm = async (question: string): Promise<boolean> => {
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    const answer = await rl.question(`${question} ${pc.dim('[y/N]')} `);

    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
};

const fail = (error: unknown): never => {
  if (error instanceof DeviasApiError) {
    console.error(pc.red(`${error.code}: ${error.message}`));

    if (error.details) {
      console.error(pc.dim(JSON.stringify(error.details, null, 2)));
    }
  } else {
    console.error(pc.red(error instanceof Error ? error.message : String(error)));
  }

  process.exit(1);
};

const applyManifest = async (
  client: ReturnType<typeof createClient>,
  manifest: ModuleManifest,
  opts: { allowDestructive: boolean; yes: boolean; quiet?: boolean },
) => {
  const plan = await client.modules.plan(manifest);

  if (!opts.quiet) {
    console.log(renderPlan(plan));
  }

  const actionable = plan.changes.filter((c) => c.action !== 'noop');

  if (actionable.length === 0) {
    if (!opts.quiet) {
      console.log(pc.dim('Nothing to apply.'));
    }

    return plan;
  }

  if (plan.hasConflicts) {
    throw new Error('Plan has conflicts; resolve them before applying.');
  }

  if (plan.hasDestructive && !opts.allowDestructive) {
    throw new Error('Plan has destructive changes; re-run with --allow-destructive to apply them.');
  }

  if (!opts.yes && !(await confirm('Apply these changes?'))) {
    console.log(pc.dim('Aborted.'));

    return plan;
  }

  const result = await client.modules.apply(manifest, {
    expectedPlanHash: plan.planHash,
    allowDestructive: opts.allowDestructive,
  });
  console.log(
    pc.green(
      `Applied ${result.applied.length} changes; ${manifest.id}@${result.version} (metadata v${result.metadataVersion}).`,
    ),
  );

  return plan;
};

export const buildProgram = (): Command => {
  const program = new Command('devias').description('Plan and apply module manifests to a Devias workspace.');
  const withConnection = (cmd: Command) =>
    cmd
      .requiredOption('-w, --workspace <id>', 'workspace (organization) id')
      .option('-u, --url <url>', 'API base URL', process.env.DEVIAS_URL ?? 'http://localhost:3000')
      .option('-k, --api-key <key>', 'organization API key (or DEVIAS_API_KEY)')
      .requiredOption('-m, --manifest <path>', 'path to a manifest .ts/.js/.json');

  program
    .command('id')
    .description('Print new ids for a module to declare: uuids nothing reads anything out of')
    .argument('[count]', 'how many', '1')
    .action((count: string) => {
      try {
        console.log(newIds(Number(count)).join('\n'));
      } catch (error) {
        fail(error);
      }
    });

  withConnection(program.command('plan').description('Show what apply would change'))
    .option('--all', 'include unchanged entities')
    .action(async (opts) => {
      try {
        const { manifest } = await loadManifest(opts.manifest);
        const client = connect(opts);
        const plan = await client.modules.plan(manifest);
        console.log(renderPlan(plan, { showNoop: Boolean(opts.all) }));
        process.exit(plan.hasConflicts ? 2 : 0);
      } catch (error) {
        fail(error);
      }
    });

  withConnection(program.command('apply').description('Apply the manifest to the workspace'))
    .option('--allow-destructive', 'permit destructive changes', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action(async (opts) => {
      try {
        const { manifest } = await loadManifest(opts.manifest);
        await applyManifest(connect(opts), manifest, { allowDestructive: opts.allowDestructive, yes: opts.yes });
      } catch (error) {
        fail(error);
      }
    });

  withConnection(program.command('dev').description('Watch the manifest and re-apply non-destructive changes')).action(
    async (opts) => {
      try {
        const client = connect(opts);
        const { default: chokidar } = await import('chokidar');
        let running = false;
        let queued = false;
        const sync = async () => {
          if (running) {
            queued = true;

            return;
          }

          running = true;

          try {
            const { manifest } = await loadManifest(opts.manifest);
            await applyManifest(client, manifest, { allowDestructive: false, yes: true, quiet: true });
            console.log(pc.dim(`${new Date().toLocaleTimeString()} synced ${manifest.id}`));
          } catch (error) {
            console.error(pc.red(error instanceof Error ? error.message : String(error)));
          } finally {
            running = false;

            if (queued) {
              queued = false;
              void sync();
            }
          }
        };
        const { dir } = await loadManifest(opts.manifest);
        console.log(pc.dim(`Watching ${dir} …`));
        chokidar.watch(dir, { ignoreInitial: true, ignored: /node_modules/ }).on('all', () => void sync());
        await sync();
      } catch (error) {
        fail(error);
      }
    },
  );

  withConnection(program.command('uninstall').description('Remove everything the module owns'))
    .option('--allow-destructive', 'permit destructive changes', false)
    .option('-y, --yes', 'skip the confirmation prompt', false)
    .action(async (opts) => {
      try {
        const { manifest } = await loadManifest(opts.manifest);
        const client = connect(opts);
        const plan = await client.modules.plan({
          ...manifest,
          objects: [],
          fields: [],
          views: [],
          layouts: [],
          navItems: [],
          commandItems: [],
        });
        console.log(renderPlan(plan));

        if (!opts.yes && !(await confirm(`Uninstall ${manifest.id}?`))) {
          return;
        }

        const result = await client.modules.uninstall(manifest.id, { allowDestructive: opts.allowDestructive });
        console.log(pc.green(`Removed ${result.applied.length} entities.`));
      } catch (error) {
        fail(error);
      }
    });

  return program;
};

export const run = async (argv: string[]) => {
  await buildProgram().parseAsync(argv);
};
