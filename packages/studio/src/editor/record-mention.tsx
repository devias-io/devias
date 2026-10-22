import { DOCUMENT_MENTION, type LinkTarget, type LookupHit, linkOfMention, TASK_MENTION } from '@devias/core';
import { Icon, type IconName } from '@devias/ui';
import { Mention, type MentionNodeAttrs } from '@tiptap/extension-mention';
import { PluginKey } from '@tiptap/pm/state';
import { NodeViewWrapper, type ReactNodeViewProps, ReactNodeViewRenderer } from '@tiptap/react';
import type { SuggestionProps } from '@tiptap/suggestion';
import { useMemo } from 'react';
import { useAgentNames } from '../hooks/use-agents';
import { useNavigateTo } from '../hooks/use-navigate-to';
import { useRelatedLabels } from '../hooks/use-related-labels';
import { useSchema } from '../providers/schema';
import { useWorkspace } from '../providers/workspace';
import { useNavigation } from '../router/navigation';
import { inCode } from './in-code';
import { type MenuKeys, renderSuggestion, SuggestionMenu } from './suggestion-menu';

type MentionAttrs = MentionNodeAttrs & { object?: string | null };

/** The icon of what a mention points at: its object's, a workflow's, a document's, a task's, a member's or an agent's. */
const iconOf = (target: LinkTarget, objectIcon: (object: string) => IconName | undefined): IconName =>
  target.kind === 'workflow'
    ? 'workflow'
    : target.kind === 'document'
      ? 'file-text'
      : target.kind === 'task'
        ? 'check-square'
        : target.kind === 'member'
          ? 'user'
          : target.kind === 'agent'
            ? 'bot'
            : (objectIcon(target.object) ?? 'file');

/** A mention inside a document: an inline link to the record, workflow or document that shows its current label. */
function MentionChip({ node }: ReactNodeViewProps) {
  const { object, id, label } = node.attrs as MentionAttrs;
  const nav = useNavigateTo();
  const navigation = useNavigation();
  const { index } = useSchema();
  const target = object && id ? linkOfMention(object, id) : null;
  const { members } = useWorkspace();
  const agentNames = useAgentNames();
  const labels = useRelatedLabels(
    target?.kind === 'record'
      ? target.object
      : target?.kind === 'document'
        ? DOCUMENT_MENTION
        : target?.kind === 'task'
          ? TASK_MENTION
          : undefined,
    [id],
  );
  // A member's name is the workspace's to say, not a query away; what the mention saved stands in for a former member.
  const memberName = target?.kind === 'member' ? members.find((member) => member.userId === id)?.user.name : undefined;
  const agentName = target?.kind === 'agent' ? agentNames.get(id ?? '') : undefined;
  const text = memberName ?? agentName ?? labels.labels[id ?? ''] ?? label ?? id ?? '';

  if (!target) {
    return <NodeViewWrapper as="span">@{text}</NodeViewWrapper>;
  }

  return (
    <NodeViewWrapper as="span">
      <navigation.Link
        href={nav.href.link(target)}
        className="doc-mention inline-flex items-baseline gap-1 rounded-sm px-0.5 font-medium text-foreground hover:bg-muted"
        title={`Open ${text}`}
      >
        <Icon
          name={iconOf(target, (name) => index.objectsByName.get(name)?.icon)}
          className="size-3.5 self-center text-muted-foreground"
        />
        <span className="underline decoration-border underline-offset-[3px]">{text}</span>
      </navigation.Link>
    </NodeViewWrapper>
  );
}

/** What the mention menu says: its heading, what it shows before anything is typed, and when nothing matches. */
export interface MentionHint {
  heading: string;
  start: string;
  none: string;
}

const RECORD_HINT: MentionHint = {
  heading: 'Mention a record',
  start: 'Type to search people, companies, documents…',
  none: 'No matching records',
};

function MentionMenu({
  items,
  loading,
  query,
  command,
  keys,
  hint,
}: SuggestionProps<LookupHit, MentionAttrs> & { keys: MenuKeys; hint: MentionHint }) {
  const { index } = useSchema();
  const entries = useMemo(
    () =>
      items.map((hit) => ({
        key: `${hit.object}:${hit.recordId}`,
        title: hit.title,
        hint: hit.subtitle,
        icon: iconOf(linkOfMention(hit.object, hit.recordId), (name) => index.objectsByName.get(name)?.icon),
      })),
    [items, index],
  );
  const select = (i: number) => {
    const hit = items[i];

    if (hit) {
      command({ object: hit.object, id: hit.recordId, label: hit.title });
    }
  };

  return (
    <SuggestionMenu
      entries={entries}
      onSelect={select}
      keys={keys}
      heading={query.trim() ? undefined : hint.heading}
      empty={loading ? 'Searching…' : query.trim() ? hint.none : hint.start}
    />
  );
}

/** The mention menu's plugin key, so other keymaps can tell when it is open and has the Enter key. */
export const recordMentionKey = new PluginKey('recordMention');

export type RecordLookup = (text: string) => Promise<LookupHit[]>;

/** Mentions that point at records: `@` searches the workspace; the node stores object, id and label. */
export const createRecordMention = (search: RecordLookup, hint: MentionHint = RECORD_HINT) => {
  const Menu = (props: SuggestionProps<LookupHit, MentionAttrs> & { keys: MenuKeys }) => (
    <MentionMenu {...props} hint={hint} />
  );

  return Mention.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        object: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-object'),
          renderHTML: (attributes) => (attributes.object ? { 'data-object': attributes.object } : {}),
        },
      };
    },
    addNodeView() {
      return ReactNodeViewRenderer(MentionChip, { as: 'span' });
    },
  }).configure({
    renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      pluginKey: recordMentionKey,
      char: '@',
      debounce: 150,
      // In code `@` is just a character: no menu, so no mention can be made there.
      allow: ({ state }) => !inCode(state),
      items: ({ query }) => (query.trim() ? search(query.trim()) : []),
      render: renderSuggestion<LookupHit, MentionAttrs>(Menu),
    },
  });
};
