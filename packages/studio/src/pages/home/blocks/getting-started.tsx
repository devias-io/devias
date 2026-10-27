import { coreIds, defineBlockComponent } from '@devias/core';
import { cn, Icon, InsightCard, InsightText, Skeleton } from '@devias/ui';
import { useWorkflows } from '../../../hooks/use-workflows';
import { useSchema } from '../../../providers/schema';
import { useWorkspace } from '../../../providers/workspace';
import { links } from '../../../router/links';
import { useNavigation } from '../../../router/navigation';
import { useRecordCounts } from './records';

interface Step {
  id: string;
  title: string;
  detail: string;
  href: string;
  done: boolean;
}

/**
 * A new workspace's first steps, each ticked off from the workspace itself: a module is installed, a record exists, a
 * workflow automates something, the data model has something of the workspace's own. Admins also see the steps only they can take.
 */
function GettingStartedCard() {
  const { slug, isAdmin } = useWorkspace();
  const { schema } = useSchema();
  const navigation = useNavigation();
  const records = useRecordCounts();
  const workflows = useWorkflows();
  const loading = records.loading || (isAdmin && workflows.isPending);
  const ownDataModel =
    schema.objects.some((object) => object.moduleId === null && !object.isSystem) ||
    schema.fields.some((field) => field.moduleId === null);
  const firstObject = schema.objects[0];
  const steps: Step[] = [
    ...(isAdmin
      ? [
          {
            id: 'module',
            title: 'Add a module',
            detail: 'Install what your business needs, such as the CRM, or ask the agent.',
            href: links.settings(slug, 'modules'),
            done: schema.modules.some((module) => !module.core),
          },
        ]
      : []),
    // There is no index of objects, so the step is the first one's records; with none there is nothing to open yet.
    ...(firstObject
      ? [
          {
            id: 'record',
            title: 'Add your first record',
            detail: 'Open an object and create one, or ask the agent.',
            href: links.object(slug, firstObject.nameSingular),
            done: records.total > 0,
          },
        ]
      : []),
    ...(isAdmin
      ? [
          {
            id: 'workflow',
            title: 'Automate a routine',
            detail: 'Build a workflow that acts when records change, or ask the agent for one.',
            href: links.workflowEditor(slug),
            done: (workflows.data?.length ?? 0) > 0,
          },
          {
            id: 'data-model',
            title: 'Make the data model yours',
            detail: 'Add an object or a field for what you track.',
            href: links.settings(slug, 'data-model'),
            done: ownDataModel,
          },
        ]
      : []),
  ];
  const remaining = steps.filter((step) => !step.done).length;
  // Only the next step explains itself, so the card stays short.
  const next = steps.find((step) => !step.done)?.id;

  return (
    <InsightCard
      icon="list-checks"
      title="Getting started"
      meta={loading ? undefined : `${steps.length - remaining} of ${steps.length} done`}
    >
      {loading ? (
        <Skeleton className="h-6 w-3/4" />
      ) : remaining === 0 ? (
        <InsightText>You're all set. Hide this card with Customize whenever you like.</InsightText>
      ) : (
        <ul className="flex flex-col gap-1">
          {steps.map((step) => (
            <li key={step.id}>
              <navigation.Link
                href={step.href}
                className="group flex items-start gap-3 py-1.5 text-xs transition-colors"
                data-done={step.done || undefined}
              >
                <Icon
                  name={step.done ? 'circle-check' : 'circle'}
                  className={cn('mt-0.5 size-4 shrink-0', step.done ? 'text-foreground' : 'text-muted-foreground')}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block',
                      step.done ? 'text-muted-foreground line-through' : 'text-foreground group-hover:underline',
                    )}
                  >
                    {step.title}
                  </span>
                  {step.id === next ? <span className="block text-muted-foreground">{step.detail}</span> : null}
                </span>
              </navigation.Link>
            </li>
          ))}
        </ul>
      )}
    </InsightCard>
  );
}

export const gettingStartedBlock = defineBlockComponent({
  id: coreIds.blocks.getting_started,
  label: 'Getting started',
  icon: 'list-checks',
  surfaces: { home: { order: 0 } },
  component: GettingStartedCard,
});
