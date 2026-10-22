import type { EditorState } from '@tiptap/pm/state';

/** Whether the cursor is in code: a code block, or text with the inline `code` mark. Nothing but text goes there. */
export const inCode = (state: EditorState): boolean => {
  const { $from } = state.selection;

  if ($from.parent.type.spec.code) {
    return true;
  }

  const code = state.schema.marks.code;

  if (!code) {
    return false;
  }

  return Boolean(code.isInSet(state.storedMarks ?? $from.marks()));
};
