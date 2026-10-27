import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecordForm } from '../src/record/record-form';
import { createFakeClient, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(cleanup);

describe('RecordForm', () => {
  it('shows a required-field error and submits cleaned values once valid', async () => {
    const schema = schemaFixture();
    const client = createFakeClient(schema, recordsFixture());
    const object = schema.objects[0] as NonNullable<(typeof schema.objects)[0]>;
    const fields = schema.fields.filter((f) => f.objectId === object.id && f.type !== 'relation');
    const onSubmit = vi.fn();
    const { container } = render(
      <TestProviders client={client} schema={schema}>
        <RecordForm
          object={object}
          fields={fields}
          onSubmit={onSubmit}
          footer={() => <button type="submit">Save</button>}
        />
      </TestProviders>,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(await screen.findByText('Required')).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();

    const input = (name: string) => container.querySelector(`[data-field="${name}"] input`) as HTMLInputElement;
    fireEvent.change(input('first_name'), { target: { value: 'Ada' } });
    fireEvent.change(input('email'), { target: { value: 'not-an-email' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(screen.queryByText('Required')).toBeNull());
    expect(await screen.findByText(/Invalid email/i)).toBeTruthy();

    fireEvent.change(input('email'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toEqual({ first_name: 'Ada', email: null, stage: null });
  });
});
