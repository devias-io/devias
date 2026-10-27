import type { TextAnchor } from '@devias/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { type Editor, Extension } from '@tiptap/react';
import { anchorOfSelection, documentText, placeAnchor } from './document-text';

/** Some text of the document to underline: a comment's, or the one being written. */
export interface CommentAnchor {
  id: string;
  anchor: TextAnchor;
  /** The text of a comment that is being written, not yet saved. */
  draft?: boolean;
}

export interface CommentAnchorsOptions {
  /** The text to underline. */
  anchors: () => readonly CommentAnchor[];
  /** The comment the person is looking at, whose text is marked stronger. */
  active: () => string | null;
  /** Text was clicked (the innermost comment on it), or text without a comment. */
  onActivate: (id: string | null) => void;
  /** The comments whose text is in the document, in the order of the text; called when that changes, and after each refresh. */
  onPlaced: (ids: string[]) => void;
  /** The person asked to comment on the selection (⌘⌥M). */
  onComment: (anchor: TextAnchor) => void;
}

interface Placed {
  id: string;
  from: number;
  to: number;
}

interface State {
  decorations: DecorationSet;
  placed: Placed[];
  /** How many times the underlines were drawn again on request. */
  refreshes: number;
}

const key = new PluginKey<State>('commentAnchors');

const REFRESH = 'refresh';

/**
 * Underlines the text comments are on. A comment holds the text it was made on, not a mark in the document, so the
 * text is looked for in the document each time it changes (`placeAnchor`), and a comment whose text is gone is simply
 * not placed. The editor's content is never touched.
 */
export const CommentAnchors = Extension.create<CommentAnchorsOptions>({
  name: 'commentAnchors',
  addOptions: () => ({
    anchors: () => [],
    active: () => null,
    onActivate: () => {},
    onPlaced: () => {},
    onComment: () => {},
  }),
  addKeyboardShortcuts() {
    return {
      'Mod-Alt-m': ({ editor }) => {
        const anchor = selectionAnchor(editor);

        if (!anchor) {
          return false;
        }

        this.options.onComment(anchor);

        return true;
      },
    };
  },
  addProseMirrorPlugins() {
    const { options } = this;
    const compute = (doc: Parameters<typeof documentText>[0], refreshes: number): State => {
      const anchors = options.anchors();

      if (anchors.length === 0) {
        return { decorations: DecorationSet.empty, placed: [], refreshes };
      }

      const projected = documentText(doc);
      const active = options.active();
      const placed: Placed[] = [];
      const decorations: Decoration[] = [];

      for (const { id, anchor, draft } of anchors) {
        const range = placeAnchor(projected, anchor);

        if (!range) {
          continue;
        }

        placed.push({ id, ...range });
        decorations.push(
          Decoration.inline(range.from, range.to, {
            class: ['doc-comment-anchor', draft && 'is-draft', id === active && 'is-active'].filter(Boolean).join(' '),
            'data-comment-id': id,
          }),
        );
      }

      return { decorations: DecorationSet.create(doc, decorations), placed, refreshes };
    };

    return [
      new Plugin<State>({
        key,
        state: {
          init: (_, state) => compute(state.doc, 0),
          apply: (transaction, value, _before, state) =>
            transaction.getMeta(key) === REFRESH
              ? compute(state.doc, value.refreshes + 1)
              : transaction.docChanged
                ? compute(state.doc, value.refreshes)
                : value,
        },
        props: {
          decorations: (state) => key.getState(state)?.decorations ?? null,
          handleClick: (view, pos) => {
            const inside = (key.getState(view.state)?.placed ?? [])
              .filter((one) => one.from <= pos && pos <= one.to)
              .sort((a, b) => a.to - a.from - (b.to - b.from));
            // A comment being written is not one to look at; the innermost of the others is.
            const drafts = new Set(
              options
                .anchors()
                .filter((one) => one.draft)
                .map((one) => one.id),
            );
            const id = inside.find((one) => !drafts.has(one.id))?.id ?? null;

            if (id !== options.active()) {
              options.onActivate(id);
            }

            return false;
          },
        },
        view: () => {
          let last: string | null = null;
          let refreshes = 0;

          return {
            update: (view) => {
              const state = key.getState(view.state);
              const ids = [...(state?.placed ?? [])]
                .sort((x, y) => x.from - y.from || x.to - y.to)
                .map((one) => one.id);
              const signature = ids.join('\n');

              if (signature !== last || (state?.refreshes ?? 0) !== refreshes) {
                last = signature;
                refreshes = state?.refreshes ?? 0;
                options.onPlaced(ids);
              }
            },
          };
        },
      }),
    ];
  },
});

/** Draw the underlines again, after the comments or the one looked at have changed. */
export const refreshCommentAnchors = (editor: Editor) => {
  if (!editor.isDestroyed) {
    editor.view.dispatch(editor.state.tr.setMeta(key, REFRESH));
  }
};

/** Where the text of a comment is in the editor now, or null when it is not placed. */
export const commentRange = (editor: Editor, id: string): { from: number; to: number } | null => {
  const one = key.getState(editor.state)?.placed.find((placed) => placed.id === id);

  return one ? { from: one.from, to: one.to } : null;
};

/** Bring the text of a comment into view. */
export const scrollToComment = (editor: Editor, id: string) => {
  const range = commentRange(editor, id);

  if (!range) {
    return;
  }

  const { node } = editor.view.domAtPos(range.from);
  const element = node instanceof Element ? node : node.parentElement;
  element?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
};

/** The anchor of what is selected in the editor, or null when nothing (or too much) is. */
export const selectionAnchor = (editor: Editor): TextAnchor | null => {
  const { from, to, empty } = editor.state.selection;

  return empty ? null : anchorOfSelection(editor.state.doc, from, to);
};
