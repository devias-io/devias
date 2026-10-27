import type { TextAnchor } from '@devias/core';
import { createMockClient } from '@devias/sdk/mock';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { commentRange, RichTextEditor, type RichTextEditorHandle } from '../src/editor';
import type { CommentAnchor } from '../src/editor/comment-anchors';
import { installLayoutStubs, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

/** Where `text` starts in the editor's document. */
const positionOf = (editor: RichTextEditorHandle, text: string): number => {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    if (found < 0 && node.isText && node.text?.includes(text)) {
      found = pos + (node.text?.indexOf(text) ?? 0);
    }
  });

  return found;
};

const anchorOn = (quote: string, hint = 0): TextAnchor => ({ quote, prefix: '', suffix: '', hint });

const mount = async (value: unknown, anchors: CommentAnchor[], activeId: string | null = null) => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
  const ref = createRef<RichTextEditorHandle | null>() as { current: RichTextEditorHandle | null };
  const onActivate = vi.fn();
  const onPlaced = vi.fn();
  const onComment = vi.fn();
  const tree = (next: CommentAnchor[], active: string | null) => (
    <TestProviders client={client}>
      <RichTextEditor
        variant="page"
        value={value}
        editorRef={ref}
        comments={{ anchors: next, activeId: active, onActivate, onPlaced, onComment }}
      />
    </TestProviders>
  );
  const view = render(tree(anchors, activeId));
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
  await settle();
  const marks = () => [...view.container.querySelectorAll<HTMLElement>('.doc-comment-anchor')];

  return {
    editor: ref.current as RichTextEditorHandle,
    marks,
    onActivate,
    onPlaced,
    onComment,
    set: async (next: CommentAnchor[], active: string | null = null) => {
      view.rerender(tree(next, active));
      await settle();
    },
  };
};

describe('comments on the text of a document', () => {
  it('underlines the text of each comment, and says which comments have their text', async () => {
    const { marks, onPlaced } = await mount('The price list is attached.\n\nSee the price list again.', [
      { id: 'c1', anchor: anchorOn('attached') },
      { id: 'c2', anchor: anchorOn('gone for good') },
    ]);
    expect(marks().map((mark) => [mark.textContent, mark.dataset.commentId])).toEqual([['attached', 'c1']]);
    expect(onPlaced).toHaveBeenLastCalledWith(['c1']);
  });

  it('puts a comment on the occurrence its context names, and moves with the text', async () => {
    const { marks, editor, set } = await mount('A price list.\n\nSee the price list again.', [
      { id: 'c1', anchor: { quote: 'price list', prefix: 'See the ', suffix: ' again.', hint: 20 } },
    ]);
    expect(marks()).toHaveLength(1);
    const before = commentRange(editor, 'c1');
    expect(editor.state.doc.textBetween(before?.from ?? 0, before?.to ?? 0)).toBe('price list');
    expect(editor.state.doc.textBetween((before?.from ?? 0) - 8, before?.from ?? 0)).toBe('See the ');

    // Typing before the text leaves the comment where the text went.
    act(() => {
      editor.commands.insertContentAt(1, 'Intro. ');
    });
    const after = commentRange(editor, 'c1');
    expect(after?.from).toBe((before?.from ?? 0) + 7);
    // Changing the text takes the comment off it.
    await set([{ id: 'c1', anchor: { quote: 'price lists', prefix: '', suffix: '', hint: 0 } }]);
    expect(marks()).toHaveLength(0);
  });

  it('marks the comment looked at and the one being written, and tells which text was clicked', async () => {
    const { marks, editor, onActivate, set } = await mount('One thing and another thing.', [
      { id: 'c1', anchor: anchorOn('One thing') },
      { id: 'c2', anchor: anchorOn('another thing') },
    ]);
    expect(marks().filter((mark) => mark.classList.contains('is-active'))).toHaveLength(0);
    await set(
      [
        { id: 'c1', anchor: anchorOn('One thing') },
        { id: 'c2', anchor: anchorOn('another thing') },
        { id: 'draft', anchor: anchorOn('and'), draft: true },
      ],
      'c2',
    );
    expect(marks().find((mark) => mark.classList.contains('is-active'))?.dataset.commentId).toBe('c2');
    expect(marks().find((mark) => mark.classList.contains('is-draft'))?.textContent).toBe('and');

    const range = commentRange(editor, 'c1');
    act(() => {
      editor.view.someProp('handleClick', (handle) =>
        handle(editor.view, (range?.from ?? 0) + 2, new MouseEvent('click')),
      );
    });
    expect(onActivate).toHaveBeenLastCalledWith('c1');
    // Text without a comment lets go of the one looked at; the text being written is not a comment to look at.
    const draft = commentRange(editor, 'draft');
    act(() => {
      editor.view.someProp('handleClick', (handle) =>
        handle(editor.view, (draft?.from ?? 0) + 1, new MouseEvent('click')),
      );
    });
    expect(onActivate).toHaveBeenLastCalledWith(null);
  });

  it('asks to comment on the selection (⌘⌥M) with the text, its surroundings and its place', async () => {
    const { editor, onComment } = await mount('The price list is attached.\n\nSee the price list again.', []);
    const from = positionOf(editor, 'See the price list again.') + 'See the '.length;
    act(() => {
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to: from + 'price list'.length })
        .run();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    // Nothing is asked for while the selection is empty.
    act(() => {
      editor.commands.setTextSelection(from);
    });
    fireEvent.keyDown(editor.view.dom, { key: 'm', altKey: true, ctrlKey: true });
    expect(onComment).not.toHaveBeenCalled();
    act(() => {
      editor.commands.setTextSelection({ from, to: from + 'price list'.length });
    });
    fireEvent.keyDown(editor.view.dom, { key: 'm', altKey: true, ctrlKey: true });
    expect(onComment).toHaveBeenCalledTimes(1);
    expect(onComment.mock.calls[0]?.[0]).toMatchObject({
      quote: 'price list',
      prefix: 'The price list is attached. See the ',
      suffix: ' again.',
      hint: 36,
    });
  });
});
