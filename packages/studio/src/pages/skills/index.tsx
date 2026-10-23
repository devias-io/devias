import { definePageComponent } from '@devias/core';
import { Button, EmptyState } from '@devias/ui';
import { useQuery } from '@tanstack/react-query';
import { errorMessage } from '../../hooks/use-mutations';
import { useSkill } from '../../hooks/use-skills';
import { ids } from '../../ids';
import { useClient } from '../../providers/client';
import { useWorkspace } from '../../providers/workspace';
import { keys } from '../../query/keys';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { PageSkeleton } from '../../shell/skeletons';
import { SkillEditorPage } from './skill-editor';
import { SkillsView } from './skills-view';

/** Whether the person may write skills: the same people who shape agents. */
const useCanManage = () => {
  const client = useClient();
  const { workspaceId } = useWorkspace();

  return useQuery({ queryKey: keys.aiStatus(workspaceId), queryFn: () => client.ai.status() });
};

const locked = (action: React.ReactNode) => (
  <EmptyState
    icon="lock"
    title="Skills are written by owners and admins"
    description="Ask a workspace admin to change the skills or to give you the admin role."
    action={action}
  />
);

/** The skills agents may use: written and read by owners and admins. */
export function SkillsPage() {
  const status = useCanManage();

  if (status.isPending) {
    return <PageSkeleton />;
  }

  if (status.isError) {
    return <div className="p-4 text-xs text-destructive">{errorMessage(status.error)}</div>;
  }

  return status.data.canManage ? <SkillsView /> : locked(null);
}

/** One skill's page (`/skills/:skillId`), or a new one (`/skills/new`). */
export function SkillPage() {
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const status = useCanManage();
  const skillId = navigation.params.skillId;
  const skill = useSkill(skillId);
  const back = (
    <Button size="lg" variant="outline" onClick={() => navigation.navigate(links.skills(slug))}>
      Back to skills
    </Button>
  );

  if (status.isPending || (skillId && skill.isPending)) {
    return <PageSkeleton />;
  }

  if (status.isError) {
    return <div className="p-4 text-xs text-destructive">{errorMessage(status.error)}</div>;
  }

  if (!status.data.canManage) {
    return locked(back);
  }

  if (skillId && !skill.data) {
    return (
      <EmptyState
        icon="circle-help"
        title="Skill not found"
        description="It may not exist in this workspace."
        action={back}
      />
    );
  }

  return <SkillEditorPage key={skill.data?.id ?? 'new'} skill={skill.data ?? null} />;
}

export const skillsPages = [
  definePageComponent({ id: ids.pages.skills, path: 'skills', component: SkillsPage }),
  definePageComponent({ path: 'skills/new', component: SkillPage }),
  definePageComponent({ path: 'skills/$skillId', component: SkillPage }),
];
