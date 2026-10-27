import type { Actor, DeviasClient, RecordComment } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commentsBlock } from '../src/record/blocks/comments';
import { createFakeClient, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(cleanup);

describe('comments block', () => {
  const me: Actor = { kind: 'user', id: 'u1' };
  const comment = (
    id: string,
    title: string,
    body = '',
    author: Actor = me,
    at = new Date(2026, 9, 12, 9, Number(id)),
  ): RecordComment => ({
    id,
    object: 'person',
    recordId: 'p1',
    title,
    body,
    author,
    createdAt: at.toISOString(),
    updatedAt: at.toISOString(),
  });

  const setup = (
    initial: RecordComment[] = [
      comment('2', 'Sent the quote'),
      comment('1', 'First visit', 'Measured the **bathroom**.', { kind: 'user', id: 'u2' }),
    ],
    { admin = true, nextCursor = null as string | null } = {},
  ) => {
    const schema = schemaFixture();
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    const record = recordsFixture().person?.[0] ?? { id: 'p1', created_at: '', updated_at: '' };
    let stored = initial;
    const comments = {
      list: vi.fn(async () => ({ items: stored, nextCursor, total: stored.length })),
      create: vi.fn(async (_object: string, id: string, input: { title: string; body?: string }) => {
        const created = {
          ...comment('3', input.title, input.body ?? ''),
          recordId: id,
          createdAt: new Date().toISOString(),
        };
        stored = [created, ...stored];

        return created;
      }),
      update: vi.fn(
        async (_object: string, _id: string, commentId: string, patch: { title?: string; body?: string }) => {
          stored = stored.map((candidate) => (candidate.id === commentId ? { ...candidate, ...patch } : candidate));

          return stored.find((candidate) => candidate.id === commentId) as RecordComment;
        },
      ),
      delete: vi.fn(async (_object: string, _id: string, commentId: string) => {
        stored = stored.filter((candidate) => candidate.id !== commentId);
      }),
    } satisfies DeviasClient['comments'];
    const client = createFakeClient(schema, recordsFixture(), { comments });
    const Comments = commentsBlock.component;
    render(
      <TestProviders client={client} schema={schema} admin={admin}>
        <Comments config={{}} surface="record" record={{ ...record, id: 'p1' }} object={object} />
      </TestProviders>,
    );

    return { comments, object };
  };

  /** The box a comment is edited in: the one inside a comment, not the one that adds a new one. */
  const editBox = () =>
    within(document.querySelector('[data-slot="comment"] [data-slot="comment-box"]') as HTMLElement);

  const item = (title: string) => screen.getByText(title).closest('[data-slot="comment"]') as HTMLElement;

  it('lists comments under day headings, each with who wrote it and the full date and time, the body as Markdown', async () => {
    const { comments, object } = setup();
    await screen.findByText('Sent the quote');
    expect(comments.list).toHaveBeenCalledWith(object.nameSingular, 'p1', expect.objectContaining({ limit: 5 }));
    expect(screen.getByRole('region', { name: /Oct 12/ })).toBeTruthy();
    const visit = item('First visit');
    expect(within(visit).getByText('Grace Hopper')).toBeTruthy();
    // "Oct 12, 2026, 9:01 AM": the date, then the time.
    expect(within(visit).getByText(/^Oct 12, 2026, 9:01 AM$/)).toBeTruthy();
    expect(within(visit).getByText('bathroom').tagName).toBe('STRONG');
    expect(within(item('Sent the quote')).getByText('Test User')).toBeTruthy();
  });

  it('shows a comment an automation wrote as the automation, with a bolt and no face', async () => {
    setup([comment('4', 'Headcount reached 300+', 'Klarna now has 5,000 employees.', { kind: 'workflow', id: 'w1' })]);
    const entry = await screen.findByText('Headcount reached 300+');
    const row = entry.closest('[data-slot="comment"]') as HTMLElement;
    expect(within(row).getByText('A workflow')).toBeTruthy();
    expect(row.querySelector('[data-slot="avatar"]')).toBeNull();
    expect(row.querySelector('svg')).toBeTruthy();
  });

  it('opens a one-line box into a title and a body, and adds a comment with ⌘↵', async () => {
    const { comments, object } = setup();
    await screen.findByText('Sent the quote');
    const title = screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
    // Closed, it is the single line "Add a comment…": no body and no Save yet.
    expect(title.placeholder).toBe('Add a comment…');
    expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
    fireEvent.focus(title);
    expect(title.placeholder).toBe('Title');
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(title, { target: { value: '  Wants a heat pump  ' } });
    expect(save.disabled).toBe(false);
    // Enter in the title moves to the body instead of saving.
    fireEvent.keyDown(title, { key: 'Enter' });
    const body = screen.getByRole('textbox', { name: 'Comment' });
    expect(document.activeElement).toBe(body);
    expect(comments.create).not.toHaveBeenCalled();
    fireEvent.change(body, { target: { value: '9 kW, air to water' } });
    fireEvent.keyDown(body, { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(comments.create).toHaveBeenCalledWith(object.nameSingular, 'p1', {
        title: 'Wants a heat pump',
        body: '9 kW, air to water',
      }),
    );
    await screen.findByText('Wants a heat pump');
    expect(screen.getByRole('region', { name: 'Today' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('');
  });

  it('saves a comment that is only a title, and needs one', async () => {
    const { comments, object } = setup();
    await screen.findByText('Sent the quote');
    const title = screen.getByRole('textbox', { name: 'Title' });
    fireEvent.focus(title);
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: 'No title yet' } });
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: 'Comment' }), { target: { value: '' } });
    fireEvent.change(title, { target: { value: 'Call back Monday' } });
    fireEvent.keyDown(title, { key: 'Enter', ctrlKey: true });
    await waitFor(() =>
      expect(comments.create).toHaveBeenCalledWith(object.nameSingular, 'p1', { title: 'Call back Monday' }),
    );
  });

  it('edits a comment in place, with Escape to leave it, and removes one', async () => {
    const { comments, object } = setup();
    await screen.findByText('Sent the quote');
    const quote = item('Sent the quote');
    fireEvent.click(within(quote).getByRole('button', { name: 'Edit comment' }));
    const editor = editBox().getByRole('textbox', { name: 'Title' }) as HTMLInputElement;
    expect(editor.value).toBe('Sent the quote');
    fireEvent.keyDown(editor, { key: 'Escape' });
    expect(document.querySelector('[data-slot="comment"] [data-slot="comment-box"]')).toBeNull();
    expect(screen.getByText('Sent the quote')).toBeTruthy();

    fireEvent.click(within(item('Sent the quote')).getByRole('button', { name: 'Edit comment' }));
    fireEvent.change(editBox().getByRole('textbox', { name: 'Title' }), { target: { value: 'Sent the new quote' } });
    fireEvent.change(editBox().getByRole('textbox', { name: 'Comment' }), { target: { value: 'Revised twice.' } });
    fireEvent.keyDown(editBox().getByRole('textbox', { name: 'Comment' }), { key: 'Enter', metaKey: true });
    await waitFor(() =>
      expect(comments.update).toHaveBeenCalledWith(object.nameSingular, 'p1', '2', {
        title: 'Sent the new quote',
        body: 'Revised twice.',
      }),
    );
    await screen.findByText('Sent the new quote');

    fireEvent.click(within(item('Sent the new quote')).getByRole('button', { name: 'Delete comment' }));
    await waitFor(() => expect(comments.delete).toHaveBeenCalledWith(object.nameSingular, 'p1', '2'));
    await waitFor(() => expect(screen.queryByText('Sent the new quote')).toBeNull());
  });

  it('lets a member change only their own comments; an admin changes any', async () => {
    setup(undefined, { admin: false });
    await screen.findByText('Sent the quote');
    expect(within(item('Sent the quote')).getByRole('button', { name: 'Edit comment' })).toBeTruthy();
    // Grace's comment: nothing to edit or remove.
    expect(within(item('First visit')).queryByRole('button', { name: 'Edit comment' })).toBeNull();
    expect(within(item('First visit')).queryByRole('button', { name: 'Delete comment' })).toBeNull();
    cleanup();

    setup();
    await screen.findByText('First visit');
    expect(within(item('First visit')).getByRole('button', { name: 'Edit comment' })).toBeTruthy();
  });

  it('folds a long body behind Show more, and tells a record with no comments what they are for', async () => {
    const body = Array.from({ length: 9 }, (_, line) => `Line ${line + 1}`).join('\n\n');
    setup([comment('5', 'Long one', body), comment('6', 'Short one', 'Brief.')]);
    await screen.findByText('Long one');
    expect(within(item('Short one')).queryByRole('button', { name: /Show more/ })).toBeNull();
    const more = within(item('Long one')).getByRole('button', { name: 'Show more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    expect(more.textContent).toBe('Show less');
    cleanup();

    setup([]);
    expect(await screen.findByText(/No comments yet\. Write down what you learn about this person/)).toBeTruthy();
  });

  it('fetches older comments with a plain button, no count', async () => {
    const { comments } = setup(undefined, { nextCursor: 'c1' });
    const more = await screen.findByRole('button', { name: 'Show older comments' });
    fireEvent.click(more);
    await waitFor(() =>
      expect(comments.list).toHaveBeenLastCalledWith('person', 'p1', expect.objectContaining({ cursor: 'c1' })),
    );
  });

  it('is a tab of its own on every tabs page, with no object list', () => {
    expect(commentsBlock.surfaces.record).toMatchObject({ placement: 'tab' });
    expect(commentsBlock.surfaces.record?.objectIds).toBeUndefined();
  });
});
