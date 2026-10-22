import type { AiAgent, AiAgentUsage, AiToolInfo } from '@devias/core';
import {
  Badge,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  Icon,
  Page,
  PageHeader,
  Skeleton,
  Switch,
} from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { AgentMark } from '../../agent-chat/agent-mark';
import { formatTokens } from '../../agent-chat/format';
import { defaultAgentOf, useAgentUsage, useAiSettings, useAllAgents } from '../../hooks/use-agents';
import { errorMessage } from '../../hooks/use-mutations';
import { useClient } from '../../providers/client';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { AGENT_TEMPLATES } from './templates';

/** The list's columns from `md` up: who, what it is for, where it comes from, tools, archive. Below `md`, only who. */
const COLUMNS = 'grid-cols-[minmax(0,1fr)_2rem] md:grid-cols-[minmax(11rem,16rem)_minmax(0,1fr)_9rem_5rem_2rem]';
/** The same with the usage (conversations, tokens) people who manage agents also see. */
const COLUMNS_WITH_USAGE =
  'grid-cols-[minmax(0,1fr)_2rem] md:grid-cols-[minmax(11rem,16rem)_minmax(0,1fr)_9rem_5rem_6rem_6rem_2rem]';

/** The module that ships an agent, by its name and icon (the puzzle piece when it has none). */
interface AgentSource {
  name: string;
  icon: string;
}

/** One agent as a thin row, like a record in a table. The whole row opens its page; archiving is a button over it. */
function AgentRow({
  agent,
  isDefault,
  canManage,
  usage,
  columns,
  source,
  onArchive,
}: {
  agent: AiAgent;
  isDefault: boolean;
  canManage: boolean;
  /** Present for people who manage agents once it has loaded. */
  usage?: AiAgentUsage | undefined;
  columns: string;
  /** The module that ships the agent; absent for an agent the workspace made. */
  source?: AgentSource | undefined;
  onArchive: (archived: boolean) => void;
}) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const archived = agent.archivedAt !== null;

  return (
    <li
      data-slot="agent-row"
      data-archived={archived || undefined}
      className={cn(
        'group/agent relative grid min-h-11 items-center gap-x-4 border-b border-border px-4 py-2 text-xs last:border-b-0 hover:bg-background-hover/50',
        archived && 'text-muted-foreground',
        columns,
      )}
    >
      {canManage ? (
        <navigation.Link
          href={links.agent(slug, agent.id)}
          aria-label={`Edit ${agent.name}`}
          className="absolute inset-0 outline-none focus-visible:bg-background-hover/50"
        >
          <span className="sr-only">Edit {agent.name}</span>
        </navigation.Link>
      ) : null}
      <div className="flex min-w-0 items-center gap-3">
        {/* A fixed box, so the names line up whether an agent has a picture or only an icon. */}
        <span className={cn('flex size-7 shrink-0 items-center justify-center', archived && 'opacity-60')}>
          <AgentMark icon={agent.icon} className="size-7" />
        </span>
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-medium">{agent.name}</span>
            {isDefault ? (
              <Badge variant="outline" className="h-4 px-1.5 text-xs">
                Default
              </Badge>
            ) : null}
            {archived ? (
              <Badge variant="outline" className="h-4 px-1.5 text-xs">
                Archived
              </Badge>
            ) : null}
          </div>
          {agent.description ? (
            <div className="truncate text-xs text-muted-foreground md:hidden">{agent.description}</div>
          ) : null}
        </div>
      </div>
      <div className="hidden min-w-0 truncate text-muted-foreground md:block">{agent.description || '–'}</div>
      <div
        className="hidden min-w-0 items-center gap-1.5 text-muted-foreground md:flex"
        data-slot="agent-source"
        title={source ? `Comes with the module ${source.name}` : 'Made in this workspace'}
      >
        {source ? <Icon name={source.icon} className="size-4 shrink-0" /> : null}
        <span className="truncate">{source ? source.name : 'Workspace'}</span>
      </div>
      <div className="hidden text-muted-foreground tabular-nums md:block">
        {agent.tools ? agent.tools.length : 'All'}
      </div>
      {canManage ? (
        <>
          <div className="hidden text-muted-foreground tabular-nums md:block" data-slot="agent-conversations">
            {usage ? usage.conversations : '–'}
          </div>
          <div
            className="hidden text-muted-foreground tabular-nums md:block"
            data-slot="agent-tokens"
            title={
              usage
                ? `${usage.usage.inputTokens.toLocaleString()} in · ${usage.usage.outputTokens.toLocaleString()} out`
                : undefined
            }
          >
            {usage ? formatTokens(usage.usage.inputTokens + usage.usage.outputTokens) : '–'}
          </div>
        </>
      ) : null}
      <div className="flex justify-end">
        {canManage ? (
          <Button
            variant="ghost"
            size="icon-sm"
            className="relative z-10 opacity-0 transition-opacity group-focus-within/agent:opacity-100 group-hover/agent:opacity-100"
            aria-label={archived ? `Restore ${agent.name}` : `Archive ${agent.name}`}
            onClick={() => onArchive(!archived)}
          >
            <Icon name={archived ? 'rotate-ccw' : 'archive'} />
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** "New agent": a menu of starting points, each opening the editor with its template applied. */
function NewAgentMenu({ variant = 'default' }: { variant?: 'default' | 'outline' }) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant={variant} />}>
        <Icon name="plus" /> New agent
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {AGENT_TEMPLATES.map((template) => (
          <DropdownMenuItem
            key={template.key}
            onClick={() => navigation.navigate(`${links.agent(slug)}?template=${template.key}`)}
          >
            <Icon name={template.icon} className="text-muted-foreground" />
            <span className="flex min-w-0 flex-col">
              <span>{template.title}</span>
              <span className="text-xs text-muted-foreground">{template.description}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The workspace's agents as a table, with a way to add, change, archive and restore them. */
export function AgentsView({ canManage }: { tools?: AiToolInfo[]; canManage: boolean }) {
  const client = useClient();
  const { workspaceId } = useWorkspace();
  const queryClient = useQueryClient();
  const agents = useAllAgents();
  const settings = useAiSettings();
  const usage = useAgentUsage(canManage);
  const { index } = useSchema();
  const sources = new Map<string, AgentSource>(
    index.schema.modules.map((m) => [m.moduleId, { name: m.name, icon: m.icon ?? 'puzzle' }]),
  );
  const columns = canManage ? COLUMNS_WITH_USAGE : COLUMNS;
  const [showArchived, setShowArchived] = useState(false);

  const archive = async (agent: AiAgent, archived: boolean) => {
    try {
      await client.ai.agents.update(agent.id, { archived });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: keys.aiAgents(workspaceId) }),
        queryClient.invalidateQueries({ queryKey: keys.aiSettings(workspaceId) }),
      ]);
      toast.success(archived ? `${agent.name} archived` : `${agent.name} restored`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const all = agents.data ?? [];
  const list = all.filter((agent) => showArchived || agent.archivedAt === null);
  const hasArchived = all.some((agent) => agent.archivedAt !== null);
  const defaultId = defaultAgentOf(all, settings.data)?.id;
  const empty = !agents.isPending && all.length === 0;

  return (
    <Page fullBleed>
      <div className="px-4 pt-4">
        <PageHeader
          title="Agents"
          description={
            canManage
              ? 'What people talk to: each with its own instructions, tools and approvals. They pick one from the panel.'
              : 'What you can talk to, each with its own instructions and tools. Only owners and admins can change them.'
          }
          actions={
            <div className="flex items-center gap-3">
              {hasArchived ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch id="show-archived" size="sm" checked={showArchived} onCheckedChange={setShowArchived} />
                  <label htmlFor="show-archived" className="cursor-pointer">
                    Show archived
                  </label>
                </div>
              ) : null}
              {canManage && !empty ? <NewAgentMenu /> : null}
            </div>
          }
        />
      </div>
      {agents.isPending ? (
        <div className="flex flex-col gap-px border-y border-border px-4 py-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="my-1 h-8 w-full" />
          ))}
        </div>
      ) : empty ? (
        <div className="px-4">
          <EmptyState
            icon="bot"
            title="No agents yet"
            description="An agent is what people talk to: instructions and a set of tools, such as an analyst that only reads records."
            action={canManage ? <NewAgentMenu /> : undefined}
          />
        </div>
      ) : (
        <div className="border-y border-border" data-slot="agents">
          <div
            className={cn(
              'hidden h-9 items-center gap-x-4 border-b border-border px-4 text-xs font-medium text-muted-foreground md:grid',
              columns,
            )}
          >
            <div>Agent</div>
            <div>Purpose</div>
            <div>Source</div>
            <div>Tools</div>
            {canManage ? (
              <>
                <div>Chats</div>
                <div>Tokens</div>
              </>
            ) : null}
            <div />
          </div>
          {list.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Every agent is archived. Show archived to restore one.
            </p>
          ) : (
            <ul>
              {list.map((agent) => (
                <AgentRow
                  key={agent.id}
                  agent={agent}
                  isDefault={agent.id === defaultId}
                  canManage={canManage}
                  usage={usage.get(agent.id)}
                  columns={columns}
                  source={
                    agent.moduleId
                      ? (sources.get(agent.moduleId) ?? { name: agent.moduleId, icon: 'puzzle' })
                      : undefined
                  }
                  onArchive={(archived) => void archive(agent, archived)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Page>
  );
}
