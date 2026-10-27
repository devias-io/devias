import { TaskItem, TaskList } from '@tiptap/extension-list';
import { TableKit } from '@tiptap/extension-table';
import { StarterKit } from '@tiptap/starter-kit';

/**
 * The extensions that decide what a document can hold: its nodes and marks. The editor adds the behaviour around
 * them (the mention, the slash menu, hints); a test reads this list, plus the mention, to check that the Markdown
 * converter in core still covers everything a person can write.
 */
export const contentExtensions = [
  StarterKit.configure({ link: { openOnClick: true } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  TableKit,
];
