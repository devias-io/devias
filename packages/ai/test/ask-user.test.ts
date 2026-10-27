import { afterEach, describe, expect, it } from 'vitest';
import { text, toolUse } from '../src/testing';
import { collect, createHarness, eventsOf, type Harness, lastUserText, resolve, send } from './helpers';

let h: Harness | undefined;
afterEach(async () => {
  await h?.close();
  h = undefined;
});

let asked = 0;
/** One scripted question; each call needs an id of its own within a conversation. */
const ask = (input: Record<string, unknown>) => ({ content: [toolUse('ask_user', input, `tu_ask_${++asked}`)] });

describe('ask_user', () => {
  it('pauses for the person whatever the approval mode, and hands their answer back as the result', async () => {
    h = await createHarness([
      ask({
        question: 'Which pipeline?',
        options: [{ label: 'Sales', description: 'New deals' }, { label: 'Renewals' }],
      }),
      { content: [text('Looking at Sales.')] },
    ]);
    const id = (await h.service.conversations.create(h.owner)).id;
    const paused = eventsOf(await send(h, h.owner, id, 'show me the pipeline'), 'paused')[0];
    const pending = paused?.pending[0];
    expect(pending).toMatchObject({ name: 'ask_user', status: 'pending', requiresApproval: true });
    expect(pending?.inputRequest).toMatchObject({
      title: 'Which pipeline?',
      question: {
        options: [
          { value: 'Sales', label: 'Sales', description: 'New deals' },
          { value: 'Renewals', label: 'Renewals' },
        ],
        other: true,
      },
    });

    const harness = h;
    const answer = (values: Record<string, string>) =>
      harness.service.startResolve(harness.owner, id, pending?.id ?? '', { approved: true, values }, harness.user);
    await expect(answer({})).rejects.toMatchObject({ code: 'VALIDATION' });
    const { events, sink } = collect();
    await (await answer({ answer: 'Sales' })).run(sink);
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({
      status: 'executed',
      isError: false,
      result: { answer: 'Sales' },
    });
    // The model got the answer as the call's result.
    expect(lastUserText(harness.model)).toContain('"answer":"Sales"');
  });

  it('takes only an option when the person may not type their own, and any text for an open question', async () => {
    h = await createHarness([
      ask({ question: 'Send it?', options: [{ label: 'Yes' }, { label: 'No' }], allowOther: false }),
      { content: [text('Ok.')] },
      ask({ question: 'What is the project called?' }),
      { content: [text('Noted.')] },
    ]);
    const id = (await h.service.conversations.create(h.owner)).id;
    const first = eventsOf(await send(h, h.owner, id, 'go'), 'paused')[0]?.pending[0];
    expect(first?.inputRequest?.question).toMatchObject({ other: false });
    const harness = h;
    await expect(
      harness.service.startResolve(harness.owner, id, first?.id ?? '', { approved: true, values: { answer: 'Maybe' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION', message: 'Choose one of the options' });
    await resolve(h, h.owner, id, first?.id ?? '', false);

    const second = eventsOf(await send(h, h.owner, id, 'and one more'), 'paused')[0]?.pending[0];
    // No options: a free text answer.
    expect(second?.inputRequest?.question).toMatchObject({ options: [], other: true });
    const { events, sink } = collect();
    await (
      await harness.service.startResolve(harness.owner, id, second?.id ?? '', {
        approved: true,
        values: { answer: 'Kitchen Popescu' },
      })
    ).run(sink);
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({ result: { answer: 'Kitchen Popescu' } });
  });

  it('lets the person skip it, which the agent is told is their decision', async () => {
    h = await createHarness([
      ask({ question: 'Which one?', options: [{ label: 'A' }, { label: 'B' }] }),
      { content: [text('Fine.')] },
    ]);
    const id = (await h.service.conversations.create(h.owner)).id;
    const pending = eventsOf(await send(h, h.owner, id, 'pick'), 'paused')[0]?.pending[0];
    const events = await resolve(h, h.owner, id, pending?.id ?? '', false);
    expect(eventsOf(events, 'tool_result')[0]).toMatchObject({ status: 'rejected' });
    expect(eventsOf(events, 'done')[0]?.status).toBe('completed');
  });

  it('is one of the tools a narrow agent can be given, and brings its prompt section with it', async () => {
    h = await createHarness([{ content: [text('Hi.')] }, { content: [text('Hi.')] }]);
    const asker = await h.service.agents.create(h.owner, { label: 'Asker', tools: ['ask_user'] });
    const quiet = await h.service.agents.create(h.owner, { label: 'Quiet', tools: ['list_records'] });

    for (const agent of [asker, quiet]) {
      const conversation = await h.service.conversations.create(h.owner, { agentId: agent.id });
      await send(h, h.owner, conversation.id, 'hello');
    }

    const [withAsk, without] = h.model.requests;
    expect(withAsk?.tools.map((t) => t.name)).toEqual(['ask_user']);
    expect(withAsk?.system).toContain('## Asking the person');
    expect(without?.system).not.toContain('## Asking the person');
  });
});
