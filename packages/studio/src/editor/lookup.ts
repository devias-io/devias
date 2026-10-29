import {
  AGENT_MENTION,
  ASSET_MENTION,
  type DeviasClient,
  DOCUMENT_MENTION,
  type LookupHit,
  MEMBER_MENTION,
  type Member,
  TASK_MENTION,
  WORKFLOW_MENTION,
} from '@devias/core';

/**
 * What `@` offers: records, then the workspace's members and agents, documents and tasks whose name or text matches, assets
 * whose name or description matches, then (in a
 * message to the agent) workflows whose name matches. Whatever the person may not read is left out.
 */
export const lookupEntities = async (
  client: DeviasClient,
  text: string,
  options: { workflows?: boolean; members?: readonly Member[] } = {},
): Promise<LookupHit[]> => {
  const needle = text.trim().toLowerCase();
  const [records, documents, tasks, assets, agents, workflows] = await Promise.all([
    client.records.lookup({ text, limit: 8 }),
    client.documents.list({ search: text.trim(), limit: 3 }).catch(() => ({ items: [] })),
    client.tasks.list({ search: text.trim(), limit: 3 }).catch(() => ({ items: [] })),
    client.assets.list({ search: text.trim(), limit: 3 }).catch(() => ({ items: [] })),
    client.ai.agents.list().catch(() => []),
    options.workflows ? client.workflows.list().catch(() => []) : Promise.resolve([]),
  ]);
  const documentHits = documents.items.map(
    (document): LookupHit => ({
      object: DOCUMENT_MENTION,
      objectId: DOCUMENT_MENTION,
      recordId: document.id,
      title: document.title,
      subtitle: 'Document',
    }),
  );
  const taskHits = tasks.items.map(
    (task): LookupHit => ({
      object: TASK_MENTION,
      objectId: TASK_MENTION,
      recordId: task.id,
      title: task.title,
      subtitle: 'Task',
    }),
  );
  const assetHits = assets.items.map(
    (asset): LookupHit => ({
      object: ASSET_MENTION,
      objectId: ASSET_MENTION,
      recordId: asset.id,
      title: asset.name,
      subtitle: 'Asset',
    }),
  );
  const memberHits = (options.members ?? [])
    .filter(
      (member) => member.user.name.toLowerCase().includes(needle) || member.user.email.toLowerCase().includes(needle),
    )
    .slice(0, 3)
    .map(
      (member): LookupHit => ({
        object: MEMBER_MENTION,
        objectId: MEMBER_MENTION,
        recordId: member.userId,
        title: member.user.name,
        subtitle: 'Member',
      }),
    );
  const agentHits = agents
    .filter((agent) => agent.label.toLowerCase().includes(needle))
    .slice(0, 3)
    .map(
      (agent): LookupHit => ({
        object: AGENT_MENTION,
        objectId: AGENT_MENTION,
        recordId: agent.id,
        title: agent.label,
        subtitle: 'Agent',
      }),
    );
  const workflowHits = workflows
    .filter((workflow) => workflow.title.toLowerCase().includes(needle))
    .slice(0, 3)
    .map(
      (workflow): LookupHit => ({
        object: WORKFLOW_MENTION,
        objectId: WORKFLOW_MENTION,
        recordId: workflow.id,
        title: workflow.title,
        subtitle: 'Workflow',
      }),
    );

  return [
    ...records.slice(0, 6),
    ...memberHits,
    ...agentHits,
    ...documentHits,
    ...taskHits,
    ...assetHits,
    ...workflowHits,
  ];
};
