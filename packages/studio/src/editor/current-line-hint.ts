import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Extension } from '@tiptap/react';
import { inCode } from './in-code';

export interface CurrentLineHintOptions {
  /**
   * The hint for an empty block: its node, the name of the node it sits in, and whether the whole document is empty.
   * An empty string gives no hint.
   */
  hint: (context: { name: string; level: number | undefined; parent: string; empty: boolean }) => string;
}

/**
 * A hint on an empty document (its first line), or else on the one empty block the cursor is in, and on no other.
 * What to say is the caller's: a plain line in a document with text can be left without one. The stock placeholder
 * decides which lines are "current" by a test that also matches the lines touching the cursor, so a run of empty
 * lines each got a hint; this looks at the selection itself.
 */
export const CurrentLineHint = Extension.create<CurrentLineHintOptions>({
  name: 'currentLineHint',
  addOptions: () => ({ hint: () => '' }),
  addProseMirrorPlugins() {
    const { options, editor } = this;

    return [
      new Plugin({
        key: new PluginKey('currentLineHint'),
        props: {
          decorations: (state) => {
            const { selection, doc } = state;

            if (!editor.isEditable) {
              return null;
            }

            const first = doc.firstChild;
            const isEmpty =
              doc.childCount > 0 && doc.children.every((node) => node.isTextblock && node.content.size === 0);
            const hintFor = (node: typeof doc, at: number, parent: string) => {
              const text = options.hint({
                name: node.type.name,
                level: typeof node.attrs.level === 'number' ? node.attrs.level : undefined,
                parent,
                empty: isEmpty,
              });

              return text
                ? DecorationSet.create(state.doc, [
                    Decoration.node(at, at + node.nodeSize, { class: 'is-placeholder', 'data-placeholder': text }),
                  ])
                : null;
            };

            // An empty document always says what it takes, wherever the cursor is: the first line gets the hint.
            if (isEmpty && first && !first.type.spec.code) {
              return hintFor(first, 0, 'doc');
            }

            // In code there is nothing to suggest: no blocks, no mentions.
            if (!selection.empty || inCode(state)) {
              return null;
            }

            const { $from } = selection;
            const node = $from.parent;

            if (!node.isTextblock || node.content.size > 0) {
              return null;
            }

            return hintFor(node, $from.before(), $from.depth > 0 ? $from.node($from.depth - 1).type.name : 'doc');
          },
        },
      }),
    ];
  },
});
