import {
  ASSET_MENTION,
  DOCUMENT_MENTION,
  type LinkTarget,
  mentionObjectOf,
  parseLink,
  TASK_MENTION,
} from '@devias/core';
import { cn, Icon, type IconName } from '@devias/ui';
import { useNavigateTo } from '../hooks/use-navigate-to';
import { useRelatedLabels } from '../hooks/use-related-labels';
import { useSchema } from '../providers/schema';
import { useNavigation } from '../router/navigation';

const iconOf = (target: LinkTarget, objectIcon: string | undefined): IconName =>
  target.kind === 'record'
    ? ((objectIcon as IconName | undefined) ?? 'file')
    : target.kind === 'document'
      ? 'file-text'
      : target.kind === 'task'
        ? 'check-square'
        : target.kind === 'workflow'
          ? 'workflow'
          : target.kind === 'agent'
            ? 'bot'
            : target.kind === 'asset'
              ? 'file'
              : 'user';

/** A record, a document, a task or an asset as a small link with its icon and its current title: `record:company/<id>`. */
export function EntityLink({ link, className }: { link: string; className?: string }) {
  const target = parseLink(link);
  const nav = useNavigateTo();
  const navigation = useNavigation();
  const { index } = useSchema();
  const labelObject =
    target?.kind === 'record'
      ? target.object
      : target?.kind === 'document'
        ? DOCUMENT_MENTION
        : target?.kind === 'task'
          ? TASK_MENTION
          : target?.kind === 'asset'
            ? ASSET_MENTION
            : undefined;
  const labels = useRelatedLabels(labelObject, [target?.id]);

  if (!target) {
    return null;
  }

  const object = target.kind === 'record' ? index.objectsByName.get(target.object) : undefined;
  // An asset with no name to give (the resolver answers with the id) was deleted: what links to it says so.
  const removed = target.kind === 'asset' && !labels.isLoading && labels.labels[target.id] === target.id;
  const text = removed ? 'File removed' : labels.get(target.id) || mentionObjectOf(target);

  return (
    <navigation.Link
      href={nav.href.link(target)}
      title={`Open ${text}`}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 rounded-md bg-muted/60 px-2 py-1 text-xs font-medium transition-colors hover:bg-muted',
        removed && 'text-muted-foreground line-through',
        className,
      )}
    >
      <Icon name={iconOf(target, object?.icon)} className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{text}</span>
    </navigation.Link>
  );
}
