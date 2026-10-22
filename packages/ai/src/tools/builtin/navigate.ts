import { NavigateTargetSchema } from '@devias/core';
import { EngineError } from '@devias/data-engine';
import { z } from 'zod';
import { resolveObject, resolveView } from '../helpers';
import { defineTool } from '../types';
import { workflowRef } from '../workflow-ref';

export const navigate = defineTool({
  name: 'navigate',
  area: 'interface',
  description:
    'Open a record, an object (optionally a specific view), a workflow in the workflow editor (id or name), a document or a task (by id), a settings section (e.g. "workflows" for the list of workflows) or a page of the interface by its path (e.g. "billing"). Call it after creating or changing something the person will want to see.',
  input: z.object({ target: NavigateTargetSchema }),
  approval: 'auto',
  readOnly: true,
  moduleId: null,
  run: async ({ target }, context) => {
    const { engine, scoped, workspaceId } = context;
    const { index } = await engine.metadata.getSnapshot(workspaceId);

    switch (target.kind) {
      case 'record': {
        const object = resolveObject(index, target.object);
        await scoped.records.get(object.nameSingular, target.id);
        context.navigate({ kind: 'record', object: object.nameSingular, id: target.id });

        return { ok: true, opened: `record:${object.nameSingular}/${target.id}` };
      }
      case 'object': {
        const object = resolveObject(index, target.object);
        const view = target.viewId ? resolveView(index, object, target.viewId) : undefined;
        context.navigate({ kind: 'object', object: object.nameSingular, ...(view ? { viewId: view.id } : {}) });

        return { ok: true, opened: view ? `${object.namePlural} (${view.label})` : object.namePlural };
      }
      case 'workflow': {
        const workflow = workflowRef(await engine.workflows.list(context.ctx), target.id);

        // The editor is for owners and admins; everyone else would land on a "for admins" page.
        if (!engine.permissions.can(context.ctx, 'workflow.manage')) {
          throw new EngineError(
            'FORBIDDEN',
            'Only owners and admins can open the workflow editor; open the settings section "workflows" instead',
          );
        }

        context.navigate({ kind: 'workflow', id: workflow.id });

        return { ok: true, opened: `workflow "${workflow.title}"` };
      }
      case 'document': {
        const document = await engine.documents.get(context.ctx, target.id);
        context.navigate({ kind: 'document', id: document.id });

        return { ok: true, opened: `document "${document.title}"` };
      }
      case 'task': {
        const task = await engine.tasks.get(context.ctx, target.id);
        context.navigate({ kind: 'task', id: task.id });

        return { ok: true, opened: `task "${task.title}"` };
      }
      case 'settings':
        context.navigate(target);

        return { ok: true, opened: `settings${target.section ? `/${target.section}` : ''}` };
      case 'page':
        context.navigate(target);

        return { ok: true, opened: `page ${target.pagePath}` };
    }
  },
});
