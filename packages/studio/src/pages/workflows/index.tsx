import { definePageComponent } from '@devias/core';
import { Button, EmptyState, Icon, Page, PageHeader } from '@devias/ui';
import { useWorkflows } from '../../hooks/use-workflows';
import { ids } from '../../ids';
import { roleSatisfies, useWorkspace } from '../../providers/workspace';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { PageSkeleton } from '../../shell/skeletons';
import { WorkflowEditorPage } from './workflow-editor';
import { WorkflowsList } from './workflow-list';

export function WorkflowsPage() {
  const { slug, role, roleStatus } = useWorkspace();
  const navigation = useNavigation();
  const workflows = useWorkflows();
  const empty = workflows.isSuccess && workflows.data.length === 0;

  if (roleStatus === 'loading') {
    return <PageSkeleton />;
  }

  if (!roleSatisfies(role, 'admin')) {
    return (
      <EmptyState
        icon="lock"
        title="Workflows are for admins"
        description="Ask a workspace admin to make this change or to give you the admin role."
      />
    );
  }

  return (
    <Page fullBleed>
      <div className="px-4 pt-4">
        <PageHeader
          title="Workflows"
          description="Automations that run on record changes, schedules, manual runs or module events."
          actions={
            empty ? undefined : (
              <Button onClick={() => navigation.navigate(links.workflowEditor(slug))}>
                <Icon name="plus" /> New workflow
              </Button>
            )
          }
        />
      </div>
      <div className="pb-8">
        <WorkflowsList />
      </div>
    </Page>
  );
}

export const workflowsPages = [
  definePageComponent({ id: ids.pages.workflows, path: 'workflows', component: WorkflowsPage }),
  definePageComponent({ path: 'workflows/new', component: WorkflowEditorPage }),
  definePageComponent({ path: 'workflows/$workflowId', component: WorkflowEditorPage }),
];
