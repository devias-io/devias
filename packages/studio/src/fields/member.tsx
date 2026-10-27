import { defineFieldType, opsForFieldType } from '@devias/core';
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@devias/ui';
import { useState } from 'react';
import { useWorkspace } from '../providers/workspace';
import { initials } from '../shell/user-menu';
import { Empty, isEmptyValue } from './shared';

const NONE = '__none__';

/** A person with their avatar: a workspace member, or a user id the workspace no longer has. */
function Person({ userId, size = 'sm' }: { userId: string; size?: 'sm' | 'default' }) {
  const { members } = useWorkspace();
  const member = members.find((candidate) => candidate.userId === userId);
  // Until the members load, or for someone who left, there is no name to show.
  const name = member?.user.name ?? (members.length === 0 ? '' : 'Former member');

  return (
    <span className="flex min-w-0 items-center gap-2">
      <Avatar size={size}>
        {member?.user.image ? <AvatarImage src={member.user.image} alt={name} /> : null}
        <AvatarFallback>{member ? initials(member.user.name) : '?'}</AvatarFallback>
      </Avatar>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** A workspace member: stored as their user id, shown with their name and avatar, picked from the team. */
export const memberFieldType = defineFieldType<string, Record<string, never>>({
  type: 'member',
  label: 'Team member',
  icon: 'user',
  category: 'relation',
  cell: ({ value }) => (isEmptyValue(value) ? <Empty /> : <Person userId={String(value)} />),
  editor: ({ field, value, onChange, mode, onCommit, onCancel, disabled, invalid }) => {
    const { members } = useWorkspace();
    const [changed, setChanged] = useState(false);
    const items = [
      ...(field.isRequired ? [] : [{ value: NONE, label: '— Nobody —' }]),
      ...members.map((member) => ({ value: member.userId, label: member.user.name })),
    ];

    return (
      <Select
        items={items}
        value={value ?? (field.isRequired ? null : NONE)}
        disabled={disabled}
        defaultOpen={mode === 'inline'}
        onValueChange={(next) => {
          onChange(next === NONE || next === null ? null : String(next));
          setChanged(true);

          if (mode === 'inline') {
            onCommit?.();
          }
        }}
        onOpenChange={(open) => {
          if (!open && mode === 'inline' && !changed) {
            onCancel?.();
          }
        }}
      >
        <SelectTrigger
          size={mode === 'inline' ? 'sm' : 'default'}
          className="w-full"
          aria-invalid={invalid || undefined}
        >
          <SelectValue placeholder="Choose a person…">
            {(current: unknown) =>
              current === NONE || current === null || current === undefined ? (
                '— Nobody —'
              ) : (
                <Person userId={String(current)} />
              )
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value} label={item.label}>
              {item.value === NONE ? (
                <span className="text-muted-foreground">{item.label}</span>
              ) : (
                <Person userId={item.value} />
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  },
  filter: { operators: opsForFieldType('member') },
  sortable: false,
  groupable: false,
  searchable: false,
  toText: (value) => value ?? '',
});
