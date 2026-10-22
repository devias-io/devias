import type { ApprovalBlockProps, InputRequest, RevealedValue, ToolCall } from '@devias/core';
import {
  Button,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
  cn,
  Field,
  FieldDescription,
  FieldLabel,
  Icon,
  type IconName,
  Input,
} from '@devias/ui';
import { type ComponentType, type FormEvent, Fragment, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '../../hooks/use-mutations';
import { ModulePolicies } from '../../pages/settings/sections/module-consent';
import { useClient } from '../../providers/client';
import { useSchema } from '../../providers/schema';
import { useBlocks } from '../../registries';
import { ErrorBoundary } from '../../shell/error-boundary';
import { callBody, isPlain, PAIRS, readsAsSentence, summarize, titleOf } from './tool-call-summary';

export { toolLabel } from './tool-call-summary';

/** How a call is drawn: the icon always, the words only where the icon is not enough. */
const STATUS: Record<
  ToolCall['status'],
  { label: string; icon: IconName; className: string; spin?: boolean; say?: boolean }
> = {
  pending: { label: 'Needs approval', icon: 'circle-alert', className: 'text-warning', say: true },
  approved: { label: 'Approved', icon: 'check', className: 'text-muted-foreground', say: true },
  running: { label: 'Running', icon: 'loader-circle', className: 'text-muted-foreground', spin: true },
  executed: { label: 'Done', icon: 'check', className: 'text-muted-foreground' },
  failed: { label: 'Failed', icon: 'circle-x', className: 'text-destructive' },
  rejected: { label: 'Rejected', icon: 'octagon-x', className: 'text-muted-foreground', say: true },
  declined: { label: 'Not run', icon: 'minus', className: 'text-muted-foreground', say: true },
};

const pretty = (value: unknown, max = 1200): string => {
  if (typeof value === 'string') {
    return value;
  }

  let json: string;

  try {
    json = JSON.stringify(value, null, 2) ?? 'null';
  } catch {
    json = String(value);
  }

  return json.length > max ? `${json.slice(0, max)}…` : json;
};

/** One value of a call's input or result: text as text, a short nested value on one line, a long one as JSON. */
function Value({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-muted-foreground">–</span>;
  }

  if (typeof value === 'string') {
    return <span className="break-words whitespace-pre-wrap">{value}</span>;
  }

  if (typeof value !== 'object') {
    return <span>{String(value)}</span>;
  }

  if (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0) {
    return <span className="text-muted-foreground">None</span>;
  }

  const oneLine = JSON.stringify(value);

  if (oneLine.length <= 56) {
    return <code className="font-mono text-xs break-words">{oneLine}</code>;
  }

  return (
    <pre className="max-h-48 overflow-auto rounded-lg border border-border px-2.5 py-2 font-mono text-xs whitespace-pre-wrap">
      {pretty(value)}
    </pre>
  );
}

/** What a call was given, or what it returned: an object as label and value pairs, anything else as it is. */
function Details({ label, value, streaming }: { label: string; value: unknown; streaming?: boolean }) {
  const entries = !streaming && isPlain(value) ? Object.entries(value) : null;

  return (
    <div data-slot="tool-call-details" className="flex flex-col gap-1.5">
      <div className="text-xs font-medium">{label}</div>
      {streaming ? (
        <pre className="max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap">{`${value}…`}</pre>
      ) : entries && entries.length > 0 ? (
        <dl className={PAIRS}>
          {entries.map(([key, entry]) => (
            <Fragment key={key}>
              <dt className="truncate text-muted-foreground">{key}</dt>
              <dd className="min-w-0">
                <Value value={entry} />
              </dd>
            </Fragment>
          ))}
        </dl>
      ) : (
        <Value value={value} />
      )}
    </div>
  );
}

/** What the call was given and what it returned, as the tool saw them: closed until someone asks for it. */
function TechnicalDetails({ call, streaming }: { call: ToolCall; streaming: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        <Icon name="chevron-down" className={cn('size-3.5 transition-transform', !open && '-rotate-90')} />
        Technical details
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 flex flex-col gap-3">
          <Details label="Input" value={call.input} streaming={streaming} />
          {call.result !== undefined ? <Details label="Result" value={call.result} /> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The values a call asks the person for, typed here and sent with the approval, straight to the server: the model
 * never sees them, and they are not kept in the conversation.
 */
function InputRequestForm({
  request,
  callId,
  busy,
  onSubmit,
  onCancel,
}: {
  request: InputRequest;
  callId: string;
  busy?: boolean;
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const missing = request.fields.some((field) => field.required && !values[field.name]?.trim());
  const submit = (event: FormEvent) => {
    event.preventDefault();

    if (missing) {
      return;
    }

    const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));
    setValues({});
    onSubmit(filled);
  };

  return (
    <form
      data-slot="input-request"
      onSubmit={submit}
      className="flex flex-col gap-2.5 border-t border-border px-3 py-3"
    >
      <div>
        <div className="font-medium">{request.title}</div>
        <div className="text-muted-foreground">
          {request.description ? `${request.description} ` : ''}The agent won't see what you type.
        </div>
      </div>
      {request.fields.map((field) => {
        const id = `input-${callId}-${field.name}`;

        return (
          <Field key={field.name} className="gap-1">
            <FieldLabel htmlFor={id} className="text-xs">
              {field.label}
              {field.required ? null : <span className="ml-1 text-muted-foreground">optional</span>}
            </FieldLabel>
            <Input
              id={id}
              name={field.name}
              type={field.secret ? 'password' : 'text'}
              autoComplete="off"
              placeholder={field.placeholder}
              value={values[field.name] ?? ''}
              onChange={(e) => setValues({ ...values, [field.name]: e.target.value })}
              className="h-7 text-xs"
            />
            {field.help ? <FieldDescription className="text-xs">{field.help}</FieldDescription> : null}
          </Field>
        );
      })}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={busy || missing} data-action="approve">
          <Icon name="lock" /> Save
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy} data-action="reject">
          <Icon name="x" /> Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * A question from the agent, as a flat card of its own like the approval widgets: the question as the sentence, the
 * options as outlined rows (the number keys 1 to 6 answer), a field and a send pill for an answer of the person's own
 * when the agent allows one (or asked an open question), and Skip. Unlike what a form collects, the answer goes back to
 * the agent, so one click on an option is the whole answer.
 */
function QuestionCard({
  call,
  request,
  question,
  busy,
  onResolve,
}: {
  call: ToolCall;
  request: InputRequest;
  question: NonNullable<InputRequest['question']>;
  busy?: boolean | undefined;
  onResolve: (approved: boolean, values?: Record<string, string>) => void;
}) {
  const [text, setText] = useState('');
  const answer = (value: string) => {
    const trimmed = value.trim();

    if (trimmed && !busy) {
      onResolve(true, { answer: trimmed });
    }
  };
  const { options } = question;
  const typed = text.trim().length > 0;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the number keys answer from anywhere in the card
    <div
      data-slot="question"
      data-call={call.id}
      className="flex flex-col gap-3 rounded-2xl bg-muted/60 p-4 text-xs"
      onKeyDown={(event) => {
        // Typing an answer of their own is not a pick.
        if (event.target instanceof HTMLInputElement || event.metaKey || event.ctrlKey || event.altKey) {
          return;
        }

        const option = options[Number(event.key) - 1];

        if (option) {
          event.preventDefault();
          answer(option.value);
        }
      }}
    >
      <div className="flex flex-col gap-1.5">
        <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <Icon name="circle-help" className="size-4" /> Question
        </span>
        <p className="text-sm leading-snug font-medium">{request.title}</p>
      </div>
      {options.length > 0 ? (
        <ul className="flex flex-col gap-1.5" aria-label="Options">
          {options.map((option, index) => (
            <li key={option.value}>
              <button
                type="button"
                disabled={busy}
                onClick={() => answer(option.value)}
                data-option={option.value}
                className="flex w-full items-start gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors outline-none hover:border-foreground/40 focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                <kbd className="mt-px flex size-5 shrink-0 items-center justify-center rounded-xs border border-border font-sans text-[12px] font-semibold text-muted-foreground">
                  {index + 1}
                </kbd>
                <span className="min-w-0">
                  <span className="block font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="block text-muted-foreground">{option.description}</span>
                  ) : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex items-center gap-2">
        {question.other ? (
          <form
            className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-muted py-1 pr-1 pl-3 focus-within:ring-[1.5px] focus-within:ring-foreground"
            onSubmit={(event) => {
              event.preventDefault();
              answer(text);
            }}
          >
            <input
              aria-label={options.length > 0 ? 'Your own answer' : 'Your answer'}
              placeholder={options.length > 0 ? 'Or type your own…' : 'Your answer'}
              autoComplete="off"
              value={text}
              onChange={(event) => setText(event.target.value)}
              className="min-w-0 flex-1 bg-transparent py-1.5 outline-none placeholder:text-muted-foreground"
            />
            <Button
              type="submit"
              size="icon-sm"
              className="rounded-full"
              aria-label="Send"
              disabled={busy || !typed}
              data-action="approve"
            >
              <Icon name="arrow-up" />
            </Button>
          </form>
        ) : (
          <span className="flex-1" />
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={() => onResolve(false)}
          disabled={busy}
          data-action="reject"
        >
          Skip
        </Button>
      </div>
    </div>
  );
}

/** How often the card looks for the new connection while the consent page is open. */
const CONNECT_POLL_MS = 1500;

/**
 * An account to connect: the provider's consent page opens in a window of its own, and the call is approved once the
 * account shows up among the connections, so the agent can say who was connected. Neither the page nor what the
 * person agrees to there reaches the agent.
 */
function ConnectRequest({
  request,
  busy,
  onResolve,
}: {
  request: InputRequest & { connect: NonNullable<InputRequest['connect']> };
  busy?: boolean;
  onResolve: (approved: boolean) => void;
}) {
  const client = useClient();
  const { connect } = request;
  const [waiting, setWaiting] = useState(false);
  /** The connections as they were before the page opened: a new or refreshed one is what the person just made. */
  const before = useRef(new Map<string, string>());
  // The latest callback, so a re-render does not restart the polling.
  const resolve = useRef(onResolve);
  resolve.current = onResolve;

  const open = async () => {
    // Opened right away, inside the click, so pop-up blockers let it through; it goes to the consent page next.
    const popup = window.open('about:blank', 'devias-connect', 'popup,width=520,height=680');

    try {
      const list = await client.modules.connections.list({ module: connect.module });
      before.current = new Map(list.connections.map((connection) => [connection.id, connection.updatedAt]));
      const { url } = await client.modules.connections.authorize({
        module: connect.module,
        provider: connect.provider,
        visibility: connect.visibility,
      });

      if (popup) {
        popup.location.href = url;
      } else {
        window.open(url, '_blank');
      }

      setWaiting(true);
    } catch (error) {
      popup?.close();
      toast.error(errorMessage(error));
    }
  };

  useEffect(() => {
    if (!waiting) {
      return;
    }

    const timer = setInterval(async () => {
      const list = await client.modules.connections.list({ module: connect.module }).catch(() => null);
      const made = list?.connections.find(
        (connection) =>
          connection.providerId === connect.provider &&
          connection.visibility === connect.visibility &&
          before.current.get(connection.id) !== connection.updatedAt,
      );

      if (made) {
        clearInterval(timer);
        setWaiting(false);
        resolve.current(true);
      }
    }, CONNECT_POLL_MS);

    return () => clearInterval(timer);
  }, [waiting, client, connect.module, connect.provider, connect.visibility]);

  return (
    <div data-slot="connect-request" className="flex flex-col gap-2.5 border-t border-border px-3 py-3">
      <div>
        <div className="font-medium">{request.title}</div>
        <div className="text-muted-foreground">
          {request.description ? `${request.description} ` : ''}You agree on the provider's own page; the agent never
          sees it.
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => void open()} disabled={busy || waiting} data-action="connect">
          <Icon name="external-link" /> {waiting ? 'Waiting for you to agree…' : `Connect ${connect.label}`}
        </Button>
        {waiting ? (
          <Button size="sm" variant="outline" onClick={() => onResolve(true)} disabled={busy} data-action="approve">
            <Icon name="check" /> I've connected
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={() => onResolve(false)} disabled={busy} data-action="reject">
          <Icon name="x" /> Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * A module to install: who publishes it, what it adds, what its code may do and what it says needs review. Installing from here is the person's consent; the agent applies exactly this version.
 */
function ConsentRequest({
  request,
  busy,
  onResolve,
}: {
  request: InputRequest & { consent: NonNullable<InputRequest['consent']> };
  busy?: boolean;
  onResolve: (approved: boolean) => void;
}) {
  const { consent } = request;

  return (
    <div data-slot="consent-request" className="flex flex-col gap-3 border-t border-border px-3 py-3">
      <div>
        <div className="font-medium">{request.title}</div>
        <div className="text-muted-foreground">
          {consent.publisher ? `${consent.publisher} · ` : ''}v{consent.version}
          {consent.fromVersion ? ` (now v${consent.fromVersion})` : ''}
        </div>
        {request.description ? <div className="mt-1">{request.description}</div> : null}
      </div>
      {consent.changes.length > 0 ? (
        <ul className="flex flex-col gap-0.5 text-muted-foreground">
          {consent.changes.map((change) => (
            <li key={change}>{change}</li>
          ))}
        </ul>
      ) : null}
      {consent.policies.length > 0 ? (
        <div className="flex flex-col gap-1">
          <div className="font-medium">Defaults: what needs review</div>
          <ModulePolicies policies={consent.policies} />
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => onResolve(true)} disabled={busy} data-action="approve">
          <Icon name="download" /> {consent.fromVersion ? 'Update' : 'Install'}
        </Button>
        <Button size="sm" variant="outline" onClick={() => onResolve(false)} disabled={busy} data-action="reject">
          <Icon name="x" /> Cancel
        </Button>
      </div>
    </div>
  );
}

/** Values a call produced for the person only, shown once: they are not kept, and the model never had them. */
function Revealed({ values }: { values: RevealedValue[] }) {
  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied');
    } catch {
      toast.error('Could not copy; select the text instead');
    }
  };

  return (
    <div
      data-slot="revealed"
      className="mt-2 flex flex-col gap-1.5 rounded-lg border border-border bg-card px-3 py-2.5"
    >
      {values.map((item) => (
        <div key={item.label} className="flex flex-col gap-1">
          <div className="font-medium">{item.label}</div>
          <div className="flex items-center gap-1.5">
            <Input
              readOnly
              value={item.value}
              className="h-7 font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button size="icon-sm" variant="outline" onClick={() => void copy(item.value)} aria-label="Copy">
              <Icon name="copy" />
            </Button>
          </div>
        </div>
      ))}
      <div className="text-muted-foreground">Copy it now: it is shown only once, and the agent never sees it.</div>
    </div>
  );
}

export interface ToolCallCardProps {
  call: ToolCall;
  /** Present while the call waits for approval and the panel can act; `values` answer its input request. */
  onResolve?: (approved: boolean, values?: Record<string, string>) => void;
  busy?: boolean;
}

/** Whether the call stops for the person's yes or no (not while its input is still streaming in). */
const isAwaiting = (call: ToolCall): boolean =>
  call.status === 'pending' && call.requiresApproval && typeof call.input !== 'string';

/** Whether the panel can answer a waiting call now (a function, so the checks on `onResolve` below still narrow it). */
const canAnswer = (onResolve: unknown): boolean => onResolve !== undefined;

/**
 * One call the agent made. A module may draw the approval of its own tool (an `approval` block): that widget
 * replaces the card below while the call waits, and the card is what shows if the widget fails. Everything else is
 * the card.
 */
export function ToolCallCard(props: ToolCallCardProps) {
  const { call, onResolve, busy } = props;
  const widgets = useBlocks('approval');

  // A question is a card of its own, not a row that opens: what is asked is what the person is here to read.
  if (onResolve && isAwaiting(call) && call.inputRequest?.question) {
    return (
      <QuestionCard
        call={call}
        request={call.inputRequest}
        question={call.inputRequest.question}
        busy={busy}
        onResolve={onResolve}
      />
    );
  }

  // Answers that need more than yes or no (secrets, an account, an install) have their own forms, so no widget.
  const widget =
    onResolve && isAwaiting(call) && !call.inputRequest
      ? widgets.find((block) => block.surfaces.approval?.tools.includes(call.name))
      : undefined;

  if (!widget || !onResolve) {
    return <CallCard {...props} />;
  }

  const Widget = widget.component as unknown as ComponentType<ApprovalBlockProps>;

  return (
    <ErrorBoundary compact title={`${widget.label} failed to load`} fallback={<CallCard {...props} />}>
      <div data-slot="tool-call" data-status={call.status} data-widget={widget.id} className="text-xs">
        <Widget
          config={{}}
          surface="approval"
          call={call}
          busy={Boolean(busy)}
          approve={() => onResolve(true)}
          reject={() => onResolve(false)}
        />
        {/* Why it asks stays the studio's to say, so a widget cannot leave it out. */}
        {call.reason ? (
          <p className="mt-2 flex items-start gap-1.5 text-muted-foreground">
            <Icon name="shield" className="mt-0.5 size-3.5 shrink-0 text-warning" />
            {call.reason}
          </p>
        ) : null}
        <div className="mt-2">
          <TechnicalDetails call={call} streaming={false} />
        </div>
      </div>
    </ErrorBoundary>
  );
}

/**
 * The card for a call. Once it has run it is a quiet row (a small status icon, what it did, a word about the result)
 * that opens to show what it was given and what it returned. A call that waits for the person is a card of its own,
 * with what it will do already open and the buttons or the form to answer it.
 */
function CallCard({ call, onResolve, busy }: ToolCallCardProps) {
  // Whether the person opened or closed it; until then, a call that asks for approval shows what it will do.
  const [chosen, setChosen] = useState<boolean | null>(null);
  // A call nobody has been asked about is not waiting for anyone: while its input streams in, or before the run
  // starts, it is on its way to running. Only a call the server marked as asking is "Needs approval".
  // Nor is one the panel cannot answer yet: while the turn is still streaming the call is on its way to waiting, and
  // drawing it as "Needs approval" for that moment only to swap in the real card is a flash.
  const answerable = canAnswer(onResolve);
  const shown = call.status === 'pending' && !(call.requiresApproval && answerable) ? 'running' : call.status;
  const status = STATUS[shown];
  const { index } = useSchema();
  const title = titleOf(call, index);
  const body = callBody(call, index);
  const streamingInput = typeof call.input === 'string';
  const summary = summarize(call);
  const awaiting = isAwaiting(call) && answerable;
  const open = chosen ?? (awaiting && !call.inputRequest);

  return (
    <div
      data-slot="tool-call"
      data-status={shown}
      className={cn('text-xs', awaiting ? 'rounded-lg border border-warning/40 bg-card' : '-my-0.5')}
    >
      <Collapsible open={open} onOpenChange={setChosen}>
        <CollapsibleTrigger
          className={cn(
            'group/call flex w-full min-w-0 items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50',
            awaiting ? 'px-3 py-2.5' : '-mx-2 w-[calc(100%+1rem)] px-2 py-1.5 hover:bg-background-hover/50',
          )}
        >
          <Icon name={status.icon} className={cn('size-4 shrink-0', status.className, status.spin && 'animate-spin')} />
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">{title.verb}</span>
            {/* The spaces are text of their own, so the row reads "Delete 1 person" to a screen reader too. */}
            {title.subject ? (
              <>
                {' '}
                <span className="text-muted-foreground">{title.subject}</span>
              </>
            ) : null}
            {title.note ? (
              <>
                {' '}
                <span className="text-muted-foreground">· {title.note}</span>
              </>
            ) : null}
          </span>
          {status.say ? (
            <span className={cn('shrink-0 text-xs', status.className)}>{status.label}</span>
          ) : (
            <span className="sr-only">{status.label}</span>
          )}
          <Icon
            name="chevron-down"
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition group-hover/call:text-foreground',
              !open && '-rotate-90',
              !awaiting && !open && 'opacity-0 group-hover/call:opacity-100 group-focus-visible/call:opacity-100',
            )}
          />
        </CollapsibleTrigger>
        {summary && call.isError ? (
          <div className={cn('pt-0.5 pl-6 text-destructive', awaiting && 'px-3')}>{summary}</div>
        ) : null}
        {awaiting && call.reason ? <p className="px-3 pl-9 text-muted-foreground">{call.reason}</p> : null}
        <CollapsibleContent>
          <div className={cn('pt-1.5 pb-2', awaiting ? 'px-3' : 'pl-0')}>
            <div className="ml-2 flex flex-col gap-3 border-l border-border pl-4">
              {body}
              {/* Any other tool: what it summed up, whole, since the row has to cut it short. */}
              {!body && !readsAsSentence(call.name) && summary && !call.isError ? (
                <p className="text-muted-foreground">{summary}</p>
              ) : null}
              {awaiting ? (
                // What is about to run is what the person is agreeing to, so it is shown, not tucked away.
                <Details label="Details" value={call.input} />
              ) : (
                <TechnicalDetails call={call} streaming={streamingInput} />
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {call.revealed?.length ? <Revealed values={call.revealed} /> : null}
      {awaiting && onResolve && call.inputRequest?.connect ? (
        <ConnectRequest
          request={{ ...call.inputRequest, connect: call.inputRequest.connect }}
          busy={busy}
          onResolve={(approved) => onResolve(approved)}
        />
      ) : null}
      {awaiting && onResolve && call.inputRequest?.consent ? (
        <ConsentRequest
          request={{ ...call.inputRequest, consent: call.inputRequest.consent }}
          busy={busy}
          onResolve={(approved) => onResolve(approved)}
        />
      ) : null}
      {awaiting &&
      onResolve &&
      call.inputRequest &&
      !call.inputRequest.connect &&
      !call.inputRequest.consent &&
      !call.inputRequest.question ? (
        <InputRequestForm
          request={call.inputRequest}
          callId={call.id}
          busy={busy}
          onSubmit={(values) => onResolve(true, values)}
          onCancel={() => onResolve(false)}
        />
      ) : null}
      {awaiting && onResolve && !call.inputRequest ? (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
          <Button size="sm" onClick={() => onResolve(true)} disabled={busy} data-action="approve">
            <Icon name="check" /> Approve
          </Button>
          <Button size="sm" variant="outline" onClick={() => onResolve(false)} disabled={busy} data-action="reject">
            <Icon name="x" /> Reject
          </Button>
        </div>
      ) : null}
    </div>
  );
}
