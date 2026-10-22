import { looksLikeMarkdown, markdownToRichText } from '@devias/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/react';
import { inCode } from './in-code';

/**
 * Pasting Markdown text makes the blocks it describes, the way Notion does: `# Title`, lists, to-dos, quotes, code,
 * bold and links become headings, lists, to-dos, quotes, code blocks, marks and links, and `[Name](record:…)` becomes a
 * mention. Text copied from a page (which brings HTML along) is left to the editor, and so is anything pasted into
 * code or text that does not look like Markdown. Code editors put their text on the clipboard with HTML too, so
 * theirs is recognised by their own data type.
 */
export const MarkdownPaste = Extension.create({
  name: 'markdownPaste',
  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      new Plugin({
        key: new PluginKey('markdownPaste'),
        props: {
          handlePaste: (view, event) => {
            const data = event.clipboardData;
            const plain = data?.getData('text/plain') ?? '';

            if (!data || !plain || inCode(view.state) || !looksLikeMarkdown(plain)) {
              return false;
            }

            const fromCodeEditor = data.types.includes('vscode-editor-data');

            if (data.types.includes('text/html') && !fromCodeEditor) {
              return false;
            }

            const blocks = markdownToRichText(plain).content ?? [];

            if (blocks.length === 0) {
              return false;
            }

            event.preventDefault();
            editor.chain().focus().insertContent(blocks).run();

            return true;
          },
        },
      }),
    ];
  },
});
