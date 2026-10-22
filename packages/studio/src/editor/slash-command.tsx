import { PluginKey } from '@tiptap/pm/state';
import { Extension } from '@tiptap/react';
import { Suggestion, type SuggestionProps } from '@tiptap/suggestion';
import { type BlockItem, matchBlockItems } from './block-items';
import { inCode } from './in-code';
import { type MenuKeys, renderSuggestion, SuggestionMenu } from './suggestion-menu';

function BlockMenu({ items, command, keys }: SuggestionProps<BlockItem, BlockItem> & { keys: MenuKeys }) {
  return (
    <SuggestionMenu
      entries={items}
      onSelect={(i) => {
        const item = items[i];

        if (item) {
          command(item);
        }
      }}
      keys={keys}
      heading="Basic blocks"
      empty="No matching blocks"
      tiles
    />
  );
}

/** Type `/` to turn the current line into a heading, list, to-do, quote, code, divider or mention. */
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [
      Suggestion<BlockItem, BlockItem>({
        editor: this.editor,
        pluginKey: new PluginKey('slashCommand'),
        char: '/',
        items: ({ query }) => matchBlockItems(query),
        // Blocks and mentions are for text, not for code.
        allow: ({ state }) => !inCode(state),
        command: ({ editor, range, props }) => {
          props.run(editor.chain().focus().deleteRange(range)).run();
        },
        render: renderSuggestion<BlockItem, BlockItem>(BlockMenu),
      }),
    ];
  },
});
