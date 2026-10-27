import { describe, expect, it } from 'vitest';
import { billingLabel, billingOf, billingOfCadence, cadenceKeyOf } from '../src/lib/billing';

describe('billing', () => {
  it('reads a price record: unset is one time, a recurring one without an interval is monthly', () => {
    expect(billingOf({})).toEqual({ type: 'one_time', interval: null, interval_count: 1 });
    expect(billingOf({ type: 'recurring' })).toEqual({ type: 'recurring', interval: 'month', interval_count: 1 });
    expect(billingOf({ type: 'recurring', interval: 'year', interval_count: 2 })).toEqual({
      type: 'recurring',
      interval: 'year',
      interval_count: 2,
    });
  });

  it('names the usual schedules, and spells out the others', () => {
    expect(billingLabel(billingOf({ type: 'one_time' }))).toBe('One time');
    expect(billingLabel(billingOf({ type: 'recurring', interval: 'month' }))).toBe('Monthly');
    expect(billingLabel(billingOf({ type: 'recurring', interval: 'month', interval_count: 3 }))).toBe('Every 3 months');
    expect(billingLabel(billingOf({ type: 'recurring', interval: 'week', interval_count: 2 }))).toBe('Every 2 weeks');
  });

  it('goes from a preset to what is stored and back, and has none for a schedule of its own', () => {
    expect(cadenceKeyOf(billingOfCadence('year'))).toBe('year');
    expect(billingOfCadence('quarter')).toEqual({ type: 'recurring', interval: 'month', interval_count: 3 });
    expect(cadenceKeyOf(billingOf({ type: 'recurring', interval: 'week', interval_count: 2 }))).toBeNull();
  });
});
