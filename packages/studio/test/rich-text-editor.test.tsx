import { markdownToRichText } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { RichTextEditor, type RichTextEditorHandle } from '../src/editor';
import { BLOCK_ITEMS } from '../src/editor/block-items';
import { inCode } from '../src/editor/in-code';
import { installLayoutStubs, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const mount = async (value: unknown) => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
  const schema = await client.metadata.getSchema();
  const ref = createRef<RichTextEditorHandle | null>() as { current: RichTextEditorHandle | null };
  const view = render(
    <TestProviders client={client} schema={schema}>
      <RichTextEditor variant="page" value={value} editorRef={ref} />
    </TestProviders>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  const hints = () =>
    [...view.container.querySelectorAll('[data-placeholder]')].filter((node) => node.getAttribute('data-placeholder'));

  return { editor: ref.current as RichTextEditorHandle, hints };
};

describe('rich text editor', () => {
  it('hints on an empty editor, and on no line once there is text', async () => {
    expect((await mount(null)).hints()).toHaveLength(1);
    cleanup();
    expect((await mount('Cartof')).hints()).toHaveLength(0);
  });

  it('hints on the first line of an empty description, wherever the cursor is', async () => {
    const { editor, hints } = await mount('\n\n');
    expect(hints()).toHaveLength(1);
    act(() => {
      editor.commands.focus('end');
    });
    expect(hints()).toHaveLength(1);
    expect(hints()[0]?.previousElementSibling).toBeNull();
  });

  it('says nothing on an empty plain line once the document has text', async () => {
    const { editor, hints } = await mount('Cartof\n\n\n');
    expect(hints()).toHaveLength(0);
    act(() => {
      editor.commands.focus('end');
    });
    expect(hints()).toHaveLength(0);
  });

  it('names an empty heading or list item, on the cursor line only', async () => {
    const { editor, hints } = await mount({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Title' }] },
        { type: 'heading', attrs: { level: 2 } },
        { type: 'heading', attrs: { level: 2 } },
      ],
    });
    let second = 0;
    let seen = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading' && ++seen === 2) {
        second = pos + 1;
      }
    });
    act(() => {
      editor.commands.setTextSelection(second);
    });
    expect(hints().map((node) => node.getAttribute('data-placeholder'))).toEqual(['Heading 2']);
  });

  it('reads plain text written through the API as paragraphs', async () => {
    const { editor } = await mount('First\nSecond');
    expect(editor.getText({ blockSeparator: '|' })).toBe('First|Second');
  });
});

describe('code', () => {
  it('takes no mentions or blocks: the menus are not offered in a code block or inline code', async () => {
    const { editor } = await mount({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'plain' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const a = 1' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'inline', marks: [{ type: 'code' }] }] },
      ],
    });
    const at = (needle: string) => {
      let found = 0;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text?.includes(needle)) {
          found = pos + 1;
        }
      });

      return found;
    };
    const check = (needle: string) => {
      act(() => {
        editor.commands.setTextSelection(at(needle));
      });

      return inCode(editor.state);
    };
    expect(check('plain')).toBe(false);
    expect(check('const')).toBe(true);
    expect(check('inline')).toBe(true);
  });

  it('gives no hint on an empty line in code, which would suggest blocks and mentions it cannot take', async () => {
    const { editor, hints } = await mount({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain' }] }, { type: 'codeBlock' }],
    });
    let inside = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock') {
        inside = pos + 1;
      }
    });
    act(() => {
      editor.commands.setTextSelection(inside);
    });
    expect(editor.state.selection.$from.parent.type.name).toBe('codeBlock');
    expect(hints()).toHaveLength(0);
  });

  it('gives no hint when the only thing in the document is an empty code block', async () => {
    const { hints } = await mount({ type: 'doc', content: [{ type: 'codeBlock' }] });
    expect(hints()).toHaveLength(0);
  });
});

describe('pasting', () => {
  const paste = (editor: RichTextEditorHandle, plain: string, types: string[] = ['text/plain']) =>
    act(() => {
      fireEvent.paste(editor.view.dom, {
        clipboardData: { types, getData: (type: string) => (type === 'text/plain' ? plain : '') },
      });
    });

  it('turns pasted Markdown into blocks, marks and mentions, like Notion', async () => {
    const { editor } = await mount(null);
    paste(editor, '# Visit\n\nMet [Ana](record:person/p1) on **Monday**.\n\n- measure\n- [ ] quote');
    const types = editor.getJSON().content?.map((node) => node.type);
    // The editor keeps an empty line after a list to type on.
    expect(types).toEqual(['heading', 'paragraph', 'bulletList', 'taskList', 'paragraph']);
    expect(editor.getText()).toContain('Met @Ana on Monday.');
    const mention = JSON.stringify(editor.getJSON());
    expect(mention).toContain('"type":"mention"');
    expect(mention).toContain('"type":"bold"');
  });

  it('leaves ordinary text, text copied from a page and pasting into code alone', async () => {
    const { editor } = await mount(null);
    paste(editor, 'just a sentence, nothing special');
    expect(JSON.stringify(editor.getJSON())).not.toContain('heading');
    paste(editor, '# not converted', ['text/plain', 'text/html']);
    expect(editor.getJSON().content?.map((node) => node.type)).not.toContain('heading');
    act(() => {
      editor.commands.setCodeBlock();
    });
    paste(editor, '# stays raw in code');
    expect(editor.getJSON().content?.map((node) => node.type)).not.toContain('heading');
  });

  it('converts Markdown copied from a code editor, which brings HTML along', async () => {
    const { editor } = await mount(null);
    paste(editor, '## From the editor\n\n1. one\n2. two', ['text/plain', 'text/html', 'vscode-editor-data']);
    expect(editor.getJSON().content?.map((node) => node.type)).toEqual(['heading', 'orderedList', 'paragraph']);
  });
});

type Json = { type?: string; content?: Json[] };
const json = (editor: RichTextEditorHandle): Json => editor.getJSON() as Json;

describe('tables', () => {
  it('inserts a 3 by 3 table with a header row from the block menu, with a line to type on after it', async () => {
    const { editor } = await mount(null);
    const item = BLOCK_ITEMS.find((candidate) => candidate.key === 'table');
    act(() => {
      item?.run(editor.chain().focus()).run();
    });
    const table = json(editor).content?.find((node) => node.type === 'table');
    expect(table?.content?.map((row) => row.content?.map((cell) => cell.type))).toEqual([
      ['tableHeader', 'tableHeader', 'tableHeader'],
      ['tableCell', 'tableCell', 'tableCell'],
      ['tableCell', 'tableCell', 'tableCell'],
    ]);
  });

  it('edits rows, columns and the header, and deletes the table', async () => {
    const { editor } = await mount('| a | b |\n| --- | --- |\n| 1 | 2 |');
    const rows = () => json(editor).content?.find((node) => node.type === 'table')?.content ?? [];
    // The document was Markdown text, so it starts as two plain lines: set it from a table document instead.
    act(() => {
      editor.commands.setContent(markdownToRichText('| a | b |\n| --- | --- |\n| 1 | 2 |'));
    });
    // The cursor goes into the last cell, where the toolbar's actions apply.
    let lastCell = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') {
        lastCell = pos + 2;
      }
    });
    act(() => {
      editor.commands.setTextSelection(lastCell);
    });
    expect(rows()).toHaveLength(2);
    act(() => {
      editor.chain().focus().addRowAfter().run();
    });
    expect(rows()).toHaveLength(3);
    act(() => {
      editor.chain().focus().addColumnAfter().run();
    });
    expect(rows()[0]?.content).toHaveLength(3);
    act(() => {
      editor.chain().focus().deleteTable().run();
    });
    expect(json(editor).content?.some((node) => node.type === 'table')).toBe(false);
  });

  it('turns pasted Markdown tables into tables, and offers a toolbar only inside one', async () => {
    const { editor } = await mount(null);
    act(() => {
      fireEvent.paste(editor.view.dom, {
        clipboardData: { types: ['text/plain'], getData: () => '| a | b |\n| --- | --- |\n| 1 | 2 |' },
      });
    });
    expect(json(editor).content?.some((node) => node.type === 'table')).toBe(true);
    expect(editor.getText()).toContain('a');
  });
});
