import { createMockClient } from '@devias/sdk/mock';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { RichTextEditorHandle } from '../src/editor';
import { DocumentPage } from '../src/pages/documents/document-page';
import { DocumentsPage } from '../src/pages/documents/documents-page';
import { recentDocumentsBlock } from '../src/pages/home/blocks/recent-documents';
import { MentionedInList } from '../src/record/blocks/mentioned-in';
import { createStaticNavigation } from '../src/router/navigation';
import { installLayoutStubs, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const setup = () => {
  const client = createMockClient({ workspaceId: 'ws1', manifests: [] });
  const list = (path = '/workspaces/acme/documents') =>
    render(
      <TestProviders client={client} navigation={createStaticNavigation(path)}>
        <DocumentsPage />
      </TestProviders>,
    );
  const open = (id: string) =>
    render(
      <TestProviders
        client={client}
        navigation={createStaticNavigation(`/workspaces/acme/documents/${id}`, {}, { documentId: id })}
      >
        <DocumentPage />
      </TestProviders>,
    );

  return { client, list, open };
};

describe('the documents page', () => {
  it('shows an empty state with a way to write the first one, which opens it', async () => {
    const { client, list } = setup();
    list();
    fireEvent.click((await screen.findAllByRole('button', { name: /New document/ }))[0] as HTMLElement);
    await waitFor(async () => expect((await client.documents.list()).total).toBe(1));
    const [made] = (await client.documents.list()).items;
    expect(made?.title).toBe('Untitled');
    await waitFor(() => expect(window.location.pathname).toBe(`/workspaces/acme/documents/${made?.id}`));
  });

  it('lists documents newest edit first as cards, and narrows them with the search', async () => {
    const { client, list } = setup();
    await client.documents.create({ title: 'Pricing', markdown: 'Discount table for partners.' });
    await client.documents.create({ title: 'Roadmap', markdown: 'Ship the thing.' });
    list();
    await waitFor(() => expect(document.querySelectorAll('[data-slot="document-card"]')).toHaveLength(2));
    const cards = document.querySelectorAll('[data-slot="document-card"]');
    expect([...cards].map((card) => within(card as HTMLElement).getByText(/Roadmap|Pricing/).textContent)).toEqual([
      'Roadmap',
      'Pricing',
    ]);
    expect(screen.getByText('Ship the thing.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Search documents' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Search documents' }), {
      target: { value: 'discount' },
    });
    await waitFor(() => expect(document.querySelectorAll('[data-slot="document-card"]')).toHaveLength(1));
    expect(screen.getByText('Pricing')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search documents' }), { target: { value: 'zzz' } });
    expect(await screen.findByText('No documents match')).toBeTruthy();
  });
});

describe('a document’s activity', () => {
  it('shows when it was made and who edited it, and leaves the comments to the rail', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Brief', markdown: 'Text.' });
    await client.documents.comment(doc.id, { markdown: 'Is this **final**?' });
    open(doc.id);
    const section = await waitFor(() => {
      const found = document.querySelector('[data-slot="document-timeline"]') as HTMLElement;
      expect(found).toBeTruthy();

      return found;
    });
    await waitFor(() => expect(within(section).getByText(/created this document/)).toBeTruthy());
    expect([...section.querySelectorAll('li')].map((item) => item.getAttribute('data-slot'))).toEqual([
      'timeline-change',
    ]);
    expect(within(section).queryByRole('button', { name: 'Comment' })).toBeNull();
    const rail = document.querySelector('[data-slot="document-comments"]') as HTMLElement;
    expect(await within(rail).findByText('final')).toBeTruthy();
  });
});

type EditorDom = HTMLElement & { editor: RichTextEditorHandle };

/** The Tiptap editor of the nth rich-text box on the page: the document's text is the first. */
const editorAt = (index = 0) => (document.querySelectorAll('.ProseMirror')[index] as EditorDom).editor;

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

const OFFER = 'The price list is attached.\n\nSee the price list again.';
const SECOND_PRICE_LIST = { quote: 'price list', prefix: 'See the ', suffix: ' again.', hint: 36 };

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 60));
  });

const threadsOf = () => [...document.querySelectorAll<HTMLElement>('[data-slot="document-thread"]')];
const marks = () => [...document.querySelectorAll<HTMLElement>('.doc-comment-anchor')];

describe('the comments beside a document', () => {
  it('lists the threads in the order of the text, and underlines the text they are on', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Offer', markdown: OFFER });
    await client.documents.comment(doc.id, { markdown: 'Current?', anchor: SECOND_PRICE_LIST });
    await client.documents.comment(doc.id, { markdown: 'A general remark' });
    const early = await client.documents.comment(doc.id, {
      markdown: 'Attached to what?',
      anchor: { quote: 'attached' },
    });
    await client.documents.comment(doc.id, { markdown: 'To the contract.', parent: early.id });
    open(doc.id);
    await waitFor(() => expect(threadsOf()).toHaveLength(3));
    expect(threadsOf().map((thread) => thread.textContent)).toEqual([
      expect.stringContaining('Attached to what?'),
      expect.stringContaining('Current?'),
      expect.stringContaining('A general remark'),
    ]);
    expect(threadsOf()[0]?.textContent).toContain('To the contract.');
    await waitFor(() => expect(marks()).toHaveLength(2));
    expect(marks().map((mark) => [mark.textContent, mark.closest('p')?.textContent])).toEqual([
      ['attached', 'The price list is attached.'],
      ['price list', 'See the price list again.'],
    ]);
    expect(screen.getByRole('button', { name: /^Open 3$/ })).toBeTruthy();
  });

  it('says so when the text of a comment was changed, and keeps the comment', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Offer', markdown: OFFER });
    await client.documents.comment(doc.id, { markdown: 'Current?', anchor: { quote: 'attached' } });
    await client.documents.update(doc.id, { markdown: 'Nothing like it now.' });
    open(doc.id);
    await waitFor(() => expect(threadsOf()).toHaveLength(1));
    expect(await screen.findByText('Text changed')).toBeTruthy();
    expect(threadsOf()[0]?.textContent).toContain('attached');
    expect(marks()).toHaveLength(0);
  });

  it('marks the text of the thread picked, and picks the thread of the text clicked', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Offer', markdown: OFFER });
    await client.documents.comment(doc.id, { markdown: 'Current?', anchor: SECOND_PRICE_LIST });
    await client.documents.comment(doc.id, { markdown: 'Attached to what?', anchor: { quote: 'attached' } });
    open(doc.id);
    await waitFor(() => expect(marks()).toHaveLength(2));
    expect(marks().filter((mark) => mark.classList.contains('is-active'))).toHaveLength(0);

    fireEvent.click(within(threadsOf()[1] as HTMLElement).getByRole('button', { name: /price list/ }));
    await waitFor(() => expect(marks().filter((mark) => mark.classList.contains('is-active'))).toHaveLength(1));
    expect(marks().find((mark) => mark.classList.contains('is-active'))?.textContent).toBe('price list');
    expect(threadsOf()[1]?.dataset.active).toBe('true');

    const editor = editorAt();
    act(() => {
      editor.view.someProp('handleClick', (handle) =>
        handle(editor.view, positionOf(editor, 'attached') + 2, new MouseEvent('click')),
      );
    });
    await waitFor(() => expect(threadsOf()[0]?.dataset.active).toBe('true'));
    expect(threadsOf()[1]?.dataset.active).toBeUndefined();
  });

  it('resolves a thread out of the open list, and takes it up again', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Offer', markdown: OFFER });
    await client.documents.comment(doc.id, { markdown: 'Current?', anchor: SECOND_PRICE_LIST });
    open(doc.id);
    await waitFor(() => expect(marks()).toHaveLength(1));
    fireEvent.click(within(threadsOf()[0] as HTMLElement).getByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(threadsOf()).toHaveLength(0));
    expect(screen.getByRole('button', { name: /^Open 0$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Resolved 1$/ })).toBeTruthy();
    expect(marks()).toHaveLength(0);
    expect((await client.documents.comments(doc.id)).items).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /^Resolved 1$/ }));
    await waitFor(() => expect(threadsOf()).toHaveLength(1));
    fireEvent.click(within(threadsOf()[0] as HTMLElement).getByRole('button', { name: 'Reopen' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /^Open 1$/ })).toBeTruthy());
    await waitFor(() => expect(marks()).toHaveLength(1));
    expect((await client.documents.comments(doc.id)).items).toHaveLength(1);
  });

  it('answers in the thread', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Offer', markdown: OFFER });
    await client.documents.comment(doc.id, { markdown: 'Current?', anchor: SECOND_PRICE_LIST });
    open(doc.id);
    await waitFor(() => expect(threadsOf()).toHaveLength(1));
    fireEvent.click(within(threadsOf()[0] as HTMLElement).getByRole('button', { name: 'Reply' }));
    await settle();
    const box = threadsOf()[0]?.querySelector('.ProseMirror') as EditorDom;
    act(() => {
      box.editor.commands.insertContent('Yes, from March.');
    });
    fireEvent.click(within(threadsOf()[0] as HTMLElement).getByRole('button', { name: 'Reply' }));
    await waitFor(async () => expect((await client.documents.comments(doc.id)).items[0]?.replies).toHaveLength(1));
    expect((await client.documents.comments(doc.id)).items[0]?.replies[0]).toMatchObject({
      body: 'Yes, from March.',
      anchor: null,
    });
    await waitFor(() => expect(threadsOf()[0]?.textContent).toContain('Yes, from March.'));
  });

  it('asks before deleting a comment, and takes its replies with it', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Offer', markdown: OFFER });
    const first = await client.documents.comment(doc.id, { markdown: 'Current?', anchor: SECOND_PRICE_LIST });
    await client.documents.comment(doc.id, { markdown: 'Yes.', parent: first.id });
    open(doc.id);
    await waitFor(() => expect(threadsOf()).toHaveLength(1));
    fireEvent.click(
      within(threadsOf()[0] as HTMLElement).getAllByRole('button', { name: 'Delete comment' })[0] as HTMLElement,
    );
    expect(await screen.findByText('Delete this comment?')).toBeTruthy();
    expect(screen.getByText(/Its replies are deleted with it/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(threadsOf()).toHaveLength(0));
    expect((await client.documents.comments(doc.id, { status: 'all' })).items).toHaveLength(0);
    expect(marks()).toHaveLength(0);
  });

  it('comments on the selected text, saving what was just typed first', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Offer', markdown: OFFER });
    const update = vi.spyOn(client.documents, 'update');
    open(doc.id);
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
    await settle();
    const editor = editorAt();
    // Something typed a moment ago, which has not been saved yet, and is what the comment is on.
    act(() => {
      editor.chain().focus('end').insertContent('Brand new closing line.').run();
    });
    expect(update).not.toHaveBeenCalled();
    const from = positionOf(editor, 'Brand new closing line.');
    act(() => {
      editor.commands.setTextSelection({ from, to: from + 'Brand new closing line.'.length });
    });
    fireEvent.keyDown(editor.view.dom, { key: 'm', altKey: true, ctrlKey: true });
    const draft = await waitFor(() => {
      const found = document.querySelector('[data-slot="document-comment-draft"]') as HTMLElement;
      expect(found).toBeTruthy();

      return found;
    });
    expect(draft.textContent).toContain('Brand new closing line.');
    expect(marks().some((mark) => mark.classList.contains('is-draft'))).toBe(true);
    await settle();
    act(() => {
      (draft.querySelector('.ProseMirror') as EditorDom).editor.commands.insertContent('Cut this?');
    });
    fireEvent.click(within(draft).getByRole('button', { name: 'Comment' }));
    await waitFor(async () => expect((await client.documents.comments(doc.id)).items).toHaveLength(1));
    const [thread] = (await client.documents.comments(doc.id)).items;
    expect(thread?.comment).toMatchObject({ body: 'Cut this?', anchor: { quote: 'Brand new closing line.' } });
    expect(update).toHaveBeenCalledTimes(1);
    expect((await client.documents.get(doc.id)).markdown).toContain('Brand new closing line.');
    // The box closes and the new thread is the one looked at.
    await waitFor(() => expect(document.querySelector('[data-slot="document-comment-draft"]')).toBeNull());
    await waitFor(() => expect(threadsOf()[0]?.dataset.active).toBe('true'));
  });

  it('lets a comment being written be cancelled', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Offer', markdown: OFFER });
    open(doc.id);
    await waitFor(() => expect(document.querySelector('.ProseMirror')).toBeTruthy());
    await settle();
    const editor = editorAt();
    const from = positionOf(editor, 'attached');
    act(() => {
      editor.commands.setTextSelection({ from, to: from + 'attached'.length });
    });
    fireEvent.keyDown(editor.view.dom, { key: 'm', altKey: true, ctrlKey: true });
    const draft = await waitFor(() => {
      const found = document.querySelector('[data-slot="document-comment-draft"]') as HTMLElement;
      expect(found).toBeTruthy();

      return found;
    });
    fireEvent.click(within(draft).getByRole('button', { name: 'Cancel' }));
    expect(document.querySelector('[data-slot="document-comment-draft"]')).toBeNull();
    await waitFor(() => expect(marks()).toHaveLength(0));
    expect((await client.documents.comments(doc.id)).items).toHaveLength(0);
  });
});

describe('a document page', () => {
  it('saves a new title with the version it was made from', async () => {
    const { client, open } = setup();
    const update = vi.spyOn(client.documents, 'update');
    const doc = await client.documents.create({ title: 'Plan', markdown: 'Text.' });
    open(doc.id);
    const title = await screen.findByRole('textbox', { name: 'Title' });
    fireEvent.change(title, { target: { value: 'Plan B' } });
    fireEvent.blur(title);
    await waitFor(() => expect(update).toHaveBeenCalledWith(doc.id, { title: 'Plan B', expectedVersion: 1 }));
    await waitFor(async () => expect((await client.documents.get(doc.id)).version).toBe(2));
    // The next save names the version the last one made.
    fireEvent.change(title, { target: { value: 'Plan C' } });
    fireEvent.blur(title);
    await waitFor(() => expect(update).toHaveBeenLastCalledWith(doc.id, { title: 'Plan C', expectedVersion: 2 }));
  });

  it('says when someone else saved first, and loads their version on request', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Shared', markdown: 'Text.' });
    open(doc.id);
    const title = await screen.findByRole('textbox', { name: 'Title' });
    await client.documents.update(doc.id, { title: 'Theirs' });
    fireEvent.focus(title);
    fireEvent.change(title, { target: { value: 'Mine' } });
    fireEvent.blur(title);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('changed elsewhere');
    expect((await client.documents.get(doc.id)).title).toBe('Theirs');
    fireEvent.click(within(alert).getByRole('button', { name: 'Load the latest' }));
    await waitFor(() =>
      expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLTextAreaElement).value).toBe('Theirs'),
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('asks before deleting, then goes back to the list', async () => {
    const { client, open } = setup();
    const doc = await client.documents.create({ title: 'Doomed' });
    open(doc.id);
    fireEvent.click(await screen.findByRole('button', { name: 'Document actions' }));
    fireEvent.click(await screen.findByText('Delete'));
    expect(await screen.findByText('Delete this document?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(async () => expect((await client.documents.list()).total).toBe(0));
    await waitFor(() => expect(window.location.pathname).toBe('/workspaces/acme/documents'));
  });

  it('says so when the document is gone', async () => {
    const { open } = setup();
    open('00000000-0000-4000-8000-000000000001');
    expect(await screen.findByText('Document not found')).toBeTruthy();
  });
});

describe('what mentions a document', () => {
  it('lists the documents that link to it, never itself', async () => {
    const { client } = setup();
    const target = await client.documents.create({ title: 'Target' });
    await client.documents.create({ title: 'Links to it', markdown: `See [Target](document:${target.id}).` });
    await client.documents.create({ title: 'Unrelated' });
    render(
      <TestProviders client={client}>
        <MentionedInList target={{ kind: 'document', id: target.id }} />
      </TestProviders>,
    );
    const section = (await screen.findByText('Mentioned in')).closest('section') as HTMLElement;
    expect(
      within(section)
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Links to itDocument']);
  });
});

describe('the Home block', () => {
  it('counts this week’s edits and links the latest documents', async () => {
    const { client } = setup();
    await client.documents.create({ title: 'Kickoff' });
    await client.documents.create({ title: 'Notes' });
    const Block = recentDocumentsBlock.component;
    render(
      <TestProviders client={client}>
        <Block config={{}} surface="home" />
      </TestProviders>,
    );
    expect(await screen.findByText(/documents were/)).toBeTruthy();
    expect(screen.getByText('Kickoff')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See all documents' }).getAttribute('href')).toBe(
      '/workspaces/acme/documents',
    );
  });
});
