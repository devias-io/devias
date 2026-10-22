import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { briefOf, ToolDescription } from '../../src/agent-chat/settings/tool-description';

afterEach(cleanup);

describe('the brief of a tool description', () => {
  it('is the first sentence, whatever the rest says about calling it', () => {
    const text =
      'Count records and add up number or currency fields, per group or in total, computed over every matching record. Use it for totals, sums and averages instead of paging through list_records.';
    expect(briefOf(text)).toMatchObject({
      brief:
        'Count records and add up number or currency fields, per group or in total, computed over every matching record.',
      more: true,
    });
  });

  it('does not stop at an abbreviation', () => {
    const { brief } = briefOf(
      'Dates are ISO, and select fields take their option value (e.g. EUR, percent). Ask first.',
    );
    expect(brief).toBe('Dates are ISO, and select fields take their option value (e.g. EUR, percent).');
  });

  it('has nothing more to show when the description is one short sentence', () => {
    expect(briefOf('Cancel an invitation.')).toEqual({
      brief: 'Cancel an invitation.',
      full: 'Cancel an invitation.',
      more: false,
    });
    expect(briefOf('  Delete\n a field  ').brief).toBe('Delete a field');
  });

  it('still offers the rest when one long sentence will not fit its lines', () => {
    const long = `Set the order and nesting of sidebar items in one step: ${'for each item given, its parentId and its position among its siblings, '.repeat(3)}done`;
    expect(briefOf(long).more).toBe(true);
  });
});

describe('ToolDescription', () => {
  it('shows the brief and the full text on request', () => {
    render(<ToolDescription text="Add a note to a record. Markdown works; it asks for approval." />);
    expect(screen.getByText('Add a note to a record.')).toBeTruthy();
    expect(screen.queryByText(/Markdown works/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(screen.getByText('Add a note to a record. Markdown works; it asks for approval.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Less' }));
    expect(screen.queryByText(/Markdown works/)).toBeNull();
  });

  it('has no toggle for a short description', () => {
    render(<ToolDescription text="Delete a field." />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
