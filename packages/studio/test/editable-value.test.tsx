import type { FieldMetadata, FieldTypeDefinition, ObjectMetadata, RecordData } from '@devias/core';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { booleanFieldType } from '../src/fields/boolean';
import { EditableValue } from '../src/record/editable-value';

afterEach(cleanup);

const fieldType = {
  cell: ({ value }: { value: unknown }) => <span>{String(value)}</span>,
  editor: ({ value, onCommit }: { value: unknown; onCommit: () => void }) => (
    <input aria-label="Editor" defaultValue={String(value)} onBlur={onCommit} />
  ),
} as unknown as FieldTypeDefinition;
const field = { name: 'city', label: 'City', type: 'text', settings: {} } as unknown as FieldMetadata;
const object = { nameSingular: 'company' } as unknown as ObjectMetadata;
const record = { id: 'r1', city: 'Berlin' } as unknown as RecordData;

const show = (editable: boolean) =>
  render(
    <EditableValue
      field={field}
      fieldType={fieldType}
      record={record}
      object={object}
      editable={editable}
      onCommit={vi.fn()}
    />,
  );

describe('EditableValue', () => {
  it('hints that an editable value can be changed with a pen at its right end, shown on hover', () => {
    show(true);
    const hint = document.querySelector('[data-slot="edit-hint"]');
    expect(hint).toBeTruthy();
    // Hidden until the value is hovered or focused; decorative, the value itself is the button.
    expect(hint?.getAttribute('class')).toContain('opacity-0');
    expect(hint?.getAttribute('class')).toContain('group-hover/editable:opacity-100');
    expect(hint?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button').textContent).toBe('Berlin');
  });

  it('draws no pen on a value that cannot be edited', () => {
    show(false);
    expect(document.querySelector('[data-slot="edit-hint"]')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still opens the editor when clicked', () => {
    show(true);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByLabelText('Editor')).toBeTruthy();
    expect(document.querySelector('[data-slot="edit-hint"]')).toBeNull();
  });

  it('keeps the same box while editing: the value and its editor are the same height and radius', () => {
    show(true);
    const value = screen.getByRole('button');
    expect(value.className).toContain('min-h-8');
    expect(value.className).toContain('rounded-md');
    // A border that is not drawn yet, so the text does not move when the editor's border appears.
    expect(value.className).toContain('border-transparent');
    fireEvent.click(value);
    const editing = screen.getByLabelText('Editor').parentElement as HTMLElement;
    // The editors are 28px tall for table cells; here they are as tall as the value.
    expect(editing.className).toContain('[&_[data-slot=input]]:h-8');
    expect(editing.className).toContain('[&_[data-slot=select-trigger]]:h-8');
  });
});

describe('EditableValue with a checkbox field', () => {
  const flag = { name: 'vip', label: 'VIP', type: 'boolean', settings: {} } as unknown as FieldMetadata;
  const open = (onCommit = vi.fn()) => {
    render(
      <EditableValue
        field={flag}
        fieldType={booleanFieldType as unknown as FieldTypeDefinition}
        record={{ id: 'r1', vip: true } as unknown as RecordData}
        object={object}
        editable
        onCommit={onCommit}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /yes/i }));

    return onCommit;
  };

  it('goes back to the value when focus leaves it without a choice', () => {
    const onCommit = open();
    expect(screen.getByRole('group', { name: 'VIP' })).toBeTruthy();
    fireEvent.blur(screen.getByRole('button', { name: 'Yes', pressed: true }));
    expect(screen.queryByRole('group', { name: 'VIP' })).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('goes back on Escape', () => {
    const onCommit = open();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Yes', pressed: true }), { key: 'Escape' });
    expect(screen.queryByRole('group', { name: 'VIP' })).toBeNull();
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('saves the option picked, and stays put while moving between the two', async () => {
    const onCommit = open();
    const no = screen.getByRole('button', { name: 'No' });
    // Focus moving from one option to the other is not leaving.
    fireEvent.blur(screen.getByRole('button', { name: 'Yes', pressed: true }), { relatedTarget: no });
    expect(screen.getByRole('group', { name: 'VIP' })).toBeTruthy();
    fireEvent.click(no);
    await waitFor(() => expect(onCommit).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('group', { name: 'VIP' })).toBeNull();
  });
});
