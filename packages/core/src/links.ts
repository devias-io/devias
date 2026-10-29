/**
 * What a link or a mention can point at. A record is `record:<object>/<id>`, a workflow `workflow:<id>`, a document
 * `document:<id>`, a task `task:<id>`, a workspace member `member:<id>`, an agent `agent:<id>` and an asset `asset:<id>`; in a
 * mention node the last six carry a reserved `object` (`workflow`, `document`, `task`, `member`, `agent`, `asset`), which no
 * object of a workspace may be named. This is the one place that knows all seven.
 */

/** A mention's `object` for a workflow, which is not an object of the workspace: the id is the workflow's. */
export const WORKFLOW_MENTION = 'workflow';

/** A mention's `object` for a document: the id is the document's. */
export const DOCUMENT_MENTION = 'document';

/** A mention's `object` for a task: the id is the task's. */
export const TASK_MENTION = 'task';

/** A mention's `object` for a workspace member: the id is the member's user id. */
export const MEMBER_MENTION = 'member';

/** A mention's `object` for an agent of the workspace: the id is the agent's. */
export const AGENT_MENTION = 'agent';

/** A mention's `object` for an asset (a file of the workspace's library): the id is the asset's. */
export const ASSET_MENTION = 'asset';

export type LinkTarget =
  | { kind: 'record'; object: string; id: string }
  | { kind: 'workflow'; id: string }
  | { kind: 'document'; id: string }
  | { kind: 'task'; id: string }
  | { kind: 'member'; id: string }
  | { kind: 'agent'; id: string }
  | { kind: 'asset'; id: string };

export type LinkKind = LinkTarget['kind'];

/** `record:<object>/<id>`, `workflow:<id>`, `document:<id>`, `task:<id>`, `member:<id>`, `agent:<id>` or `asset:<id>`: how the agent, Markdown and notifications refer to it. */
export const linkHref = (target: LinkTarget): string =>
  target.kind === 'record' ? `record:${target.object}/${target.id}` : `${target.kind}:${target.id}`;

const RECORD_LINK = /^record:([^/\s]+)\/(\S+)$/;
const WORKFLOW_LINK = /^workflow:(\S+)$/;
const DOCUMENT_LINK = /^document:(\S+)$/;
const TASK_LINK = /^task:(\S+)$/;
const MEMBER_LINK = /^member:(\S+)$/;
const AGENT_LINK = /^agent:(\S+)$/;
const ASSET_LINK = /^asset:(\S+)$/;

/** The target of a link, or null when it is any other link. */
export const parseLink = (href: string): LinkTarget | null => {
  const record = RECORD_LINK.exec(href);

  if (record) {
    return { kind: 'record', object: record[1] as string, id: record[2] as string };
  }

  const workflow = WORKFLOW_LINK.exec(href);

  if (workflow) {
    return { kind: 'workflow', id: workflow[1] as string };
  }

  const document = DOCUMENT_LINK.exec(href);

  if (document) {
    return { kind: 'document', id: document[1] as string };
  }

  const task = TASK_LINK.exec(href);

  if (task) {
    return { kind: 'task', id: task[1] as string };
  }

  const member = MEMBER_LINK.exec(href);

  if (member) {
    return { kind: 'member', id: member[1] as string };
  }

  const agent = AGENT_LINK.exec(href);

  if (agent) {
    return { kind: 'agent', id: agent[1] as string };
  }

  const asset = ASSET_LINK.exec(href);

  return asset ? { kind: 'asset', id: asset[1] as string } : null;
};

/** The `object` a mention node carries for this target. */
export const mentionObjectOf = (target: LinkTarget): string =>
  target.kind === 'record'
    ? target.object
    : target.kind === 'workflow'
      ? WORKFLOW_MENTION
      : target.kind === 'document'
        ? DOCUMENT_MENTION
        : target.kind === 'task'
          ? TASK_MENTION
          : target.kind === 'member'
            ? MEMBER_MENTION
            : target.kind === 'agent'
              ? AGENT_MENTION
              : ASSET_MENTION;

/** The attributes of the mention node that points at `target`. */
export const mentionAttrsOf = (target: LinkTarget, label: string): { object: string; id: string; label: string } => ({
  object: mentionObjectOf(target),
  id: target.id,
  label,
});

/** The target a mention node points at, from its `object` and `id`. */
export const linkOfMention = (object: string, id: string): LinkTarget =>
  object === WORKFLOW_MENTION
    ? { kind: 'workflow', id }
    : object === DOCUMENT_MENTION
      ? { kind: 'document', id }
      : object === TASK_MENTION
        ? { kind: 'task', id }
        : object === MEMBER_MENTION
          ? { kind: 'member', id }
          : object === AGENT_MENTION
            ? { kind: 'agent', id }
            : object === ASSET_MENTION
              ? { kind: 'asset', id }
              : { kind: 'record', object, id };

const LINK_IN_TEXT =
  /\[([^\]]*)\]\(((?:record:[^/\s)]+\/[^)\s]+)|(?:workflow:[^)\s]+)|(?:document:[^)\s]+)|(?:task:[^)\s]+)|(?:member:[^)\s]+)|(?:agent:[^)\s]+)|(?:asset:[^)\s]+))\)/g;

/** A Markdown link to one of the seven, `[Label](record:<object>/<id>)`, with where it sits in the text. */
export interface LinkInText {
  label: string;
  target: LinkTarget;
  start: number;
  end: number;
}

/** The links to records, workflows, documents, tasks, members, agents and assets in a text, in order: what a person picked with `@` in a message. */
export const linksIn = (text: string): LinkInText[] => {
  const found: LinkInText[] = [];

  for (const match of text.matchAll(LINK_IN_TEXT)) {
    const target = parseLink(match[2] ?? '');

    if (target) {
      found.push({
        label: match[1] || target.id,
        target,
        start: match.index ?? 0,
        end: (match.index ?? 0) + match[0].length,
      });
    }
  }

  return found;
};
