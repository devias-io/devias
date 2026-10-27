import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ScheduleFields } from '../src/pages/workflows/schedule-fields';

afterEach(cleanup);

/** The fields with the state the editor gives them: the expression they edit. */
function Harness({ initial }: { initial: string }) {
  const [cron, setCron] = useState(initial);

  return <ScheduleFields cron={cron} onChange={setCron} />;
}

describe('schedule fields', () => {
  it('says how often it runs, and when it runs next', () => {
    render(<ScheduleFields cron="0 9 * * 1-5" onChange={() => {}} />);
    expect(screen.getByText('On certain days of the week')).toBeTruthy();
    expect(screen.getByText(/^Weekdays at 09:00 UTC\. Next run .+ UTC\.$/)).toBeTruthy();
  });

  it('changes the days of a weekly schedule, and keeps at least one', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ScheduleFields cron="0 9 * * 1-5" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Friday' }));
    expect(onChange).toHaveBeenLastCalledWith('0 9 * * 1-4');
    fireEvent.click(screen.getByRole('button', { name: 'Sunday' }));
    expect(onChange).toHaveBeenLastCalledWith('0 9 * * 0-5');
    onChange.mockClear();
    rerender(<ScheduleFields cron="0 9 * * 1" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Monday' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('sets the time of day', () => {
    const onChange = vi.fn();
    render(<ScheduleFields cron="0 9 * * *" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('At (UTC)'), { target: { value: '18:30' } });
    expect(onChange).toHaveBeenLastCalledWith('30 18 * * *');
  });

  it('edits an expression no preset says as text, and says what is wrong with it', () => {
    render(<Harness initial="*/45 * * * *" />);
    const input = screen.getByLabelText('Cron expression') as HTMLInputElement;
    expect(input.value).toBe('*/45 * * * *');
    expect(screen.getByText(/^On the schedule \*\/45 \* \* \* \* \(UTC\)\. Next run/)).toBeTruthy();
    fireEvent.change(input, { target: { value: '0 25 * * *' } });
    expect(screen.getByText('Cron hour "25" is not valid (0-23)')).toBeTruthy();
    expect(screen.queryByText(/Next run/)).toBeNull();
  });

  it('keeps the text field while a typed expression happens to be a preset', () => {
    render(<Harness initial="*/45 * * * *" />);
    fireEvent.change(screen.getByLabelText('Cron expression'), { target: { value: '0 9 * * *' } });
    expect((screen.getByLabelText('Cron expression') as HTMLInputElement).value).toBe('0 9 * * *');
    expect(screen.getByText(/^Every day at 09:00 UTC\. Next run/)).toBeTruthy();
  });
});
