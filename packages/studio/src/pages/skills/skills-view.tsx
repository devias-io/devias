import type { AiSkillSummary } from '@devias/core';
import { Badge, Button, cn, EmptyState, Icon, Page, PageHeader, Skeleton, Switch } from '@devias/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../hooks/use-mutations';
import { useAllSkills } from '../../hooks/use-skills';
import { useClient } from '../../providers/client';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';

/** Title, when it is for, where it comes from, archive. Below `md` only the title and archive. */
const COLUMNS = 'grid-cols-[minmax(0,1fr)_2rem] md:grid-cols-[minmax(11rem,18rem)_minmax(0,1fr)_9rem_2rem]';

/** One skill as a thin row. The whole row opens its page; archiving is a button over it. */
function SkillRow({
  skill,
  source,
  onArchive,
}: {
  skill: AiSkillSummary;
  /** The module that ships the skill; absent for one the workspace wrote. */
  source?: { name: string; icon: string } | undefined;
  onArchive: (archived: boolean) => void;
}) {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const archived = skill.archivedAt !== null;

  return (
    <li
      data-slot="skill-row"
      data-archived={archived || undefined}
      className={cn(
        'group/skill relative grid min-h-11 items-center gap-x-4 border-b border-border px-4 py-2 text-xs last:border-b-0 hover:bg-background-hover/50',
        archived && 'text-muted-foreground',
        COLUMNS,
      )}
    >
      <navigation.Link
        href={links.skill(slug, skill.id)}
        aria-label={`Edit ${skill.title}`}
        className="absolute inset-0 outline-none focus-visible:bg-background-hover/50"
      >
        <span className="sr-only">Edit {skill.title}</span>
      </navigation.Link>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate font-medium">{skill.title}</span>
          {archived ? (
            <Badge variant="outline" className="h-4 px-1.5 text-xs">
              Archived
            </Badge>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground md:hidden">{skill.description}</div>
      </div>
      <div className="hidden min-w-0 truncate text-muted-foreground md:block">{skill.description}</div>
      <div
        className="hidden min-w-0 items-center gap-1.5 text-muted-foreground md:flex"
        title={source ? `Comes with the module ${source.name}` : 'Written in this workspace'}
      >
        {source ? <Icon name={source.icon} className="size-4 shrink-0" /> : null}
        <span className="truncate">{source ? source.name : 'Workspace'}</span>
      </div>
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative z-10 opacity-0 transition-opacity group-focus-within/skill:opacity-100 group-hover/skill:opacity-100"
          aria-label={archived ? `Restore ${skill.title}` : `Archive ${skill.title}`}
          onClick={() => onArchive(!archived)}
        >
          <Icon name={archived ? 'rotate-ccw' : 'archive'} />
        </Button>
      </div>
    </li>
  );
}

/** The skills agents may use, as a table, with a way to write, change, archive and restore them. */
export function SkillsView() {
  const client = useClient();
  const { workspaceId, slug } = useWorkspace();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const skills = useAllSkills();
  const { index } = useSchema();
  const sources = new Map(index.schema.modules.map((m) => [m.moduleId, { name: m.name, icon: m.icon ?? 'puzzle' }]));
  const [showArchived, setShowArchived] = useState(false);

  const archive = async (skill: AiSkillSummary, archived: boolean) => {
    try {
      await client.ai.skills.update(skill.id, { archived });
      await queryClient.invalidateQueries({ queryKey: keys.aiSkills(workspaceId) });
      toast.success(archived ? `${skill.title} archived` : `${skill.title} restored`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  const all = skills.data ?? [];
  const list = all.filter((skill) => showArchived || skill.archivedAt === null);
  const hasArchived = all.some((skill) => skill.archivedAt !== null);
  const empty = !skills.isPending && all.length === 0;
  const create = () => navigation.navigate(links.skill(slug));

  return (
    <Page fullBleed>
      <div className="px-4 pt-4">
        <PageHeader
          title="Skills"
          description="Procedures the workspace wrote for its agents. An agent sees each one's title and when to use it, and loads the rest when a request calls for it."
          actions={
            <div className="flex items-center gap-3">
              {hasArchived ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Switch
                    id="show-archived-skills"
                    size="sm"
                    checked={showArchived}
                    onCheckedChange={setShowArchived}
                  />
                  <label htmlFor="show-archived-skills" className="cursor-pointer">
                    Show archived
                  </label>
                </div>
              ) : null}
              {!empty ? (
                <Button onClick={create}>
                  <Icon name="plus" /> New skill
                </Button>
              ) : null}
            </div>
          }
        />
      </div>
      {skills.isPending ? (
        <div className="mt-3 flex flex-col gap-px border-y border-border px-4 py-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="my-1 h-8 w-full" />
          ))}
        </div>
      ) : skills.isError ? (
        <div className="p-4 text-xs text-destructive">{errorMessage(skills.error)}</div>
      ) : empty ? (
        <div className="px-4">
          <EmptyState
            icon="book-open"
            title="No skills yet"
            description="A skill is a procedure, such as how to qualify a lead. Write it once and every agent that may use it can load it when a request matches."
            action={
              <Button onClick={create}>
                <Icon name="plus" /> New skill
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-3 border-y border-border" data-slot="skills">
          <div
            className={cn(
              'hidden h-9 items-center gap-x-4 border-b border-border px-4 text-xs font-medium text-muted-foreground md:grid',
              COLUMNS,
            )}
          >
            <div>Skill</div>
            <div>When to use it</div>
            <div>Source</div>
            <div />
          </div>
          {list.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-muted-foreground">
              Every skill is archived. Show archived to restore one.
            </p>
          ) : (
            <ul>
              {list.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  source={
                    skill.moduleId
                      ? (sources.get(skill.moduleId) ?? { name: skill.moduleId, icon: 'puzzle' })
                      : undefined
                  }
                  onArchive={(archived) => void archive(skill, archived)}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Page>
  );
}
