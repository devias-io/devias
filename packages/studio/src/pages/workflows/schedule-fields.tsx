import { cronProblem, nextCronTime } from '@devias/core';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Input,
  OptionSelect,
  ToggleGroup,
  ToggleGroupItem,
} from '@devias/ui';
import { useState } from 'react';
import {
  clockText,
  cronOf,
  describeSchedule,
  HOUR_STEPS,
  MINUTE_STEPS,
  type Schedule,
  type ScheduleKind,
  scheduleOf,
  scheduleOfKind,
  WEEKDAYS,
} from './schedule';

const FREQUENCIES: { value: ScheduleKind; label: string }[] = [
  { value: 'minutes', label: 'Every few minutes' },
  { value: 'hours', label: 'Every few hours' },
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'On certain days of the week' },
  { value: 'monthly', label: 'Once a month' },
  { value: 'custom', label: 'Custom (cron)' },
];

const stepOptions = (steps: readonly number[], unit: string) =>
  steps.map((step) => ({ value: String(step), label: `${step} ${unit}${step === 1 ? '' : 's'}` }));

const when = (at: Date): string =>
  `${new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(at)} UTC`;

function TimeField({
  id,
  hour,
  minute,
  onChange,
}: {
  id: string;
  hour: number;
  minute: number;
  onChange: (hour: number, minute: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>At (UTC)</FieldLabel>
      <Input
        id={id}
        type="time"
        className="w-32"
        value={clockText(hour, minute)}
        onChange={(e) => {
          const [nextHour, nextMinute] = e.target.value.split(':').map(Number);

          if (nextHour !== undefined && nextMinute !== undefined && !Number.isNaN(nextHour + nextMinute)) {
            onChange(nextHour, nextMinute);
          }
        }}
      />
    </Field>
  );
}

const clamp = (text: string, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.trunc(Number(text) || min)));

/**
 * When a scheduled workflow runs, picked as a person says it (every 15 minutes, weekdays at 09:00) and kept as the
 * cron expression the server reads. An expression that is none of those is edited as text.
 */
export function ScheduleFields({ cron, onChange }: { cron: string; onChange: (cron: string) => void }) {
  const parsed = scheduleOf(cron);
  // An expression typed by hand that happens to be a preset must not turn the form into the preset under the cursor.
  const [custom, setCustom] = useState(parsed.kind === 'custom');
  const schedule: Schedule = custom ? { kind: 'custom', cron } : parsed;
  const set = (next: Schedule) => onChange(cronOf(next));
  const problem = cronProblem(cron);
  const next = problem ? null : nextCronTime(cron, new Date());

  return (
    <>
      <Field>
        <FieldLabel htmlFor="wf-frequency">Runs</FieldLabel>
        <OptionSelect
          id="wf-frequency"
          className="w-full"
          value={schedule.kind}
          options={FREQUENCIES}
          onValueChange={(kind) => {
            if (kind === 'custom') {
              setCustom(true);

              return;
            }

            setCustom(false);
            set(scheduleOfKind(kind, parsed));
          }}
        />
      </Field>
      {schedule.kind === 'minutes' ? (
        <Field>
          <FieldLabel htmlFor="wf-every">Every</FieldLabel>
          <OptionSelect
            id="wf-every"
            className="w-full"
            value={String(schedule.every)}
            options={stepOptions(MINUTE_STEPS, 'minute')}
            onValueChange={(every) => set({ kind: 'minutes', every: Number(every) })}
          />
        </Field>
      ) : null}
      {schedule.kind === 'hours' ? (
        <>
          <Field>
            <FieldLabel htmlFor="wf-every">Every</FieldLabel>
            <OptionSelect
              id="wf-every"
              className="w-full"
              value={String(schedule.every)}
              options={stepOptions(HOUR_STEPS, 'hour')}
              onValueChange={(every) => set({ ...schedule, every: Number(every) })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="wf-minute">At minute</FieldLabel>
            <Input
              id="wf-minute"
              type="number"
              min={0}
              max={59}
              className="w-28"
              value={schedule.minute}
              onChange={(e) => set({ ...schedule, minute: clamp(e.target.value, 0, 59) })}
            />
          </Field>
        </>
      ) : null}
      {schedule.kind === 'daily' ? (
        <TimeField
          id="wf-time"
          hour={schedule.hour}
          minute={schedule.minute}
          onChange={(hour, minute) => set({ ...schedule, hour, minute })}
        />
      ) : null}
      {schedule.kind === 'weekly' ? (
        <>
          <Field>
            <FieldLabel>On</FieldLabel>
            <ToggleGroup
              multiple
              variant="outline"
              size="sm"
              spacing={1}
              className="w-full"
              aria-label="Days of the week"
              value={schedule.days.map(String)}
              onValueChange={(days) => {
                // At least one day stays picked: no day at all is no schedule.
                if (days.length > 0) {
                  set({ ...schedule, days: days.map(Number) });
                }
              }}
            >
              {WEEKDAYS.map((day) => (
                <ToggleGroupItem key={day.value} value={String(day.value)} className="flex-1" aria-label={day.name}>
                  {day.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </Field>
          <TimeField
            id="wf-time"
            hour={schedule.hour}
            minute={schedule.minute}
            onChange={(hour, minute) => set({ ...schedule, hour, minute })}
          />
        </>
      ) : null}
      {schedule.kind === 'monthly' ? (
        <>
          <Field>
            <FieldLabel htmlFor="wf-day">On day</FieldLabel>
            <Input
              id="wf-day"
              type="number"
              min={1}
              max={31}
              className="w-28"
              value={schedule.day}
              onChange={(e) => set({ ...schedule, day: clamp(e.target.value, 1, 31) })}
            />
            {schedule.day > 28 ? <FieldDescription>Months without that day are skipped.</FieldDescription> : null}
          </Field>
          <TimeField
            id="wf-time"
            hour={schedule.hour}
            minute={schedule.minute}
            onChange={(hour, minute) => set({ ...schedule, hour, minute })}
          />
        </>
      ) : null}
      {schedule.kind === 'custom' ? (
        <Field>
          <FieldLabel htmlFor="wf-cron">Cron expression</FieldLabel>
          <Input
            id="wf-cron"
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            aria-invalid={problem ? true : undefined}
            value={cron}
            onChange={(e) => onChange(e.target.value)}
          />
          {problem ? (
            <FieldError>{problem}</FieldError>
          ) : (
            <FieldDescription>
              Minute, hour, day of the month, month and day of the week, in UTC. 0 9 * * 1-5 is weekdays at 09:00.
            </FieldDescription>
          )}
        </Field>
      ) : null}
      {problem ? null : (
        <p className="text-xs text-muted-foreground">
          {describeSchedule(cron)}.{next ? ` Next run ${when(next)}.` : ''}
        </p>
      )}
    </>
  );
}
