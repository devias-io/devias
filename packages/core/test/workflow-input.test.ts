import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { coreIds } from '../src/core-ids';
import { markdownToRichText } from '../src/rich-text-markdown';
import { renderTemplate, type WorkflowScope } from '../src/workflow';
import { richTextStepInput, textStepInput } from '../src/workflow-input';

const NOTES = [
  { name: 'notes', type: 'rich_text' },
  { name: 'title', type: 'text' },
];
const fieldsOf = (object: string) => (object === 'chore' ? NOTES : []);
const doc = markdownToRichText('Met **Ada**');

describe('rich text in a workflow step', () => {
  it('reads text written to a rich-text field as Markdown, in every record-writing action', () => {
    const converted = (input: unknown, action: string) => richTextStepInput(action, input, fieldsOf) as never;
    expect(
      converted(
        { object: 'chore', values: { notes: 'Met **Ada**', title: '**plain**' } },
        coreIds.actions.create_record,
      ),
    ).toEqual({ object: 'chore', values: { notes: doc, title: '**plain**' } });
    expect(
      converted({ object: 'chore', id: 'x', values: { notes: 'Met **Ada**' } }, coreIds.actions.update_record),
    ).toEqual({ object: 'chore', id: 'x', values: { notes: doc } });
    expect(
      converted(
        { object: 'chore', match: { title: 'a' }, values: { notes: 'Met **Ada**' } },
        coreIds.actions.upsert_record,
      ),
    ).toEqual({ object: 'chore', match: { title: 'a' }, values: { notes: doc } });
    expect(
      converted(
        {
          object: 'chore',
          create: [{ notes: 'Met **Ada**' }],
          update: [{ id: 'x', patch: { notes: 'Met **Ada**' } }],
          delete: ['y'],
        },
        coreIds.actions.batch_write_records,
      ),
    ).toEqual({
      object: 'chore',
      create: [{ notes: doc }],
      update: [{ id: 'x', patch: { notes: doc } }],
      delete: ['y'],
    });
  });

  it('keeps a document as it is, and leaves other actions and unknown objects alone', () => {
    const input = { object: 'chore', values: { notes: doc } };
    expect(richTextStepInput(coreIds.actions.create_record, input, fieldsOf)).toEqual(input);
    const other = { object: 'chore', values: { notes: 'Met **Ada**' } };
    expect(richTextStepInput(coreIds.actions.delete_records, other, fieldsOf)).toBe(other);
    expect(
      richTextStepInput(coreIds.actions.create_record, { object: 'ghost', values: { notes: 'x' } }, fieldsOf),
    ).toEqual({
      object: 'ghost',
      values: { notes: 'x' },
    });
    expect(richTextStepInput(coreIds.actions.create_record, 'text', fieldsOf)).toBe('text');
  });

  it('turns a document into Markdown where the action takes text, and nowhere else', () => {
    const schema = z.object({
      body: z.string().optional(),
      title: z.string().nullable(),
      values: z.record(z.string(), z.unknown()),
      anything: z.unknown(),
      count: z.number(),
    });
    expect(textStepInput({ body: doc, title: doc, values: { notes: doc }, anything: doc, count: 1 }, schema)).toEqual({
      body: 'Met **Ada**',
      title: 'Met **Ada**',
      values: { notes: doc },
      anything: doc,
      count: 1,
    });
    expect(textStepInput({ body: 'plain' }, schema)).toEqual({ body: 'plain' });
    expect(textStepInput({ body: doc }, undefined)).toEqual({ body: doc });
  });

  it('renders a document as Markdown inside a sentence, and keeps its type as a whole expression', () => {
    const scope = { record: { notes: doc } } as unknown as WorkflowScope;
    expect(renderTemplate('Notes: {{record.notes}}', scope)).toBe('Notes: Met **Ada**');
    expect(renderTemplate('{{record.notes}}', scope)).toEqual(doc);
  });
});
