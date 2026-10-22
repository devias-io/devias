import type { FieldMetadata, FieldTypeDefinition } from '@devias/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterValueInput } from '../src/fields/filter-input';
import { textFieldType } from '../src/fields/text';

afterEach(cleanup);

const field = {
  id: 'f1',
  name: 'name',
  label: 'Name',
  type: 'text',
  settings: {},
  isRequired: false,
} as unknown as FieldMetadata;

/** The input as the condition editor holds it: the parsed value goes up, and comes back down as a prop. */
function Host({ onChange }: { onChange: (value: unknown) => void }) {
  const [value, setValue] = useState<unknown>(null);

  return (
    <FilterValueInput
      field={field}
      fieldType={textFieldType as unknown as FieldTypeDefinition}
      op="any_of"
      value={value}
      onChange={(next) => {
        setValue(next);
        onChange(next);
      }}
    />
  );
}

describe('FilterValueInput list values', () => {
  it('keeps the commas and spaces being typed while reporting the parsed list', () => {
    const onChange = vi.fn();
    render(<Host onChange={onChange} />);
    const input = screen.getByPlaceholderText('Comma-separated values') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Ada,' } });
    expect(input.value).toBe('Ada,');
    fireEvent.change(input, { target: { value: 'Ada, ' } });
    expect(input.value).toBe('Ada, ');
    fireEvent.change(input, { target: { value: 'Ada, Linus' } });
    expect(input.value).toBe('Ada, Linus');
    expect(onChange).toHaveBeenLastCalledWith(['Ada', 'Linus']);
  });
});
