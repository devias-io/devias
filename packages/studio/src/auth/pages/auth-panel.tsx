import { cn, Icon } from '@devias/ui';
import type { CSSProperties, ReactNode } from 'react';
import { useStudioConfig } from '../../providers/studio-config';
import { RippleImage } from './ripple-image';

/** Treetops from above (photo by Maria Mekht, CC0). It is the brand's own lime, and it gives the glass something to blur. */
const IMAGE = new URL('./sign-in-forest.webp', import.meta.url).href;

/** A floating pane of frosted glass over the photo: tinted dark enough to read white text on, blurred behind. */
function Glass({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      className={cn(
        'absolute rounded-lg border border-white/25 bg-black/25 p-4 text-white shadow-[0_16px_48px_-16px_rgba(0,0,0,0.5)] backdrop-blur-xl backdrop-saturate-150 motion-safe:animate-float',
        className,
      )}
      style={style}
    >
      {children}
    </div>
  );
}

/** Money in: a figure, how it moved, and the line behind it. */
function MoneyIn() {
  return (
    <Glass className="top-[9%] left-[8%] w-72" style={{ animationDelay: '-2s' }}>
      <div className="text-xs text-white/70">Money in · last 7 days</div>
      <div className="mt-1 flex items-center gap-2">
        <span className="text-2xl font-medium tracking-tight">€32,725</span>
        <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-medium text-brand-foreground">+18%</span>
      </div>
      <svg viewBox="0 0 240 56" className="mt-3 h-14 w-full" fill="none" role="presentation">
        <title>Trend</title>
        <defs>
          <linearGradient id="auth-money-wash" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="white" stopOpacity="0.35" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 44 L30 38 L60 41 L90 28 L120 31 L150 18 L180 22 L210 9 L240 12 V56 H0 Z"
          fill="url(#auth-money-wash)"
        />
        <path
          d="M0 44 L30 38 L60 41 L90 28 L120 31 L150 18 L180 22 L210 9 L240 12"
          stroke="white"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx="240" cy="12" r="4" fill="white" />
      </svg>
    </Glass>
  );
}

/** The agent doing a piece of work, and asking before it sends. */
function AgentAsk() {
  // An image the app maps for agents, else the icon on a lime dot.
  const avatar = useStudioConfig().agentImages['avatar-1'];

  return (
    <Glass className="top-[34%] right-[7%] w-80" style={{ animationDelay: '-5s' }}>
      <div className="flex items-center gap-2">
        {avatar ? (
          <img
            src={avatar}
            alt=""
            draggable={false}
            className="size-7 rounded-full object-cover ring-1 ring-white/40"
          />
        ) : (
          <span className="flex size-7 items-center justify-center rounded-full bg-brand text-brand-foreground">
            <Icon name="agent" className="size-4" />
          </span>
        )}
        <span className="text-xs font-medium">Agent</span>
      </div>
      <p className="mt-3 rounded-lg bg-white/15 px-3 py-2 text-xs leading-snug">
        Invoice Northwind Labs for October and send it on Friday.
      </p>
      <div className="mt-3 flex items-start gap-2 text-xs">
        <Icon name="circle-check" className="mt-0.5 size-4 shrink-0 text-brand" />
        <span>
          Invoice INV-0042 for <span className="font-medium">€2,400.00</span> is ready.
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <span className="rounded-full bg-brand px-3 py-1 text-xs font-medium text-brand-foreground">Approve</span>
        <span className="rounded-full bg-white/15 px-3 py-1 text-xs font-medium">Review</span>
      </div>
    </Glass>
  );
}

/** A workflow that just ran on its own. Left out on short screens, where it would crowd the others. */
function WorkflowRan() {
  return (
    <Glass
      className="bottom-[24%] left-[10%] flex items-center gap-3 py-3 pr-4 [@media(max-height:780px)]:hidden"
      style={{ animationDelay: '-7s' }}
    >
      <span className="flex size-9 items-center justify-center rounded-lg bg-white/15">
        <Icon name="zap" className="size-4.5" />
      </span>
      <div className="leading-tight">
        <div className="text-xs font-medium">Overdue reminder</div>
        <div className="mt-0.5 text-xs text-white/70">Ran just now · 3 emails sent</div>
      </div>
      <Icon name="circle-check" className="ml-2 size-5 text-brand" />
    </Glass>
  );
}

/**
 * The picture beside the sign-in and sign-up forms: a photo in a rounded frame, three panes of glass floating over it
 * (what the product does: money, the agent, workflows) and the line that says what it is for. Decorative, so it
 * is hidden from assistive tech and from small screens.
 */
export function AuthPanel() {
  return (
    <aside className="hidden p-3 lg:block" aria-hidden="true">
      <div className="relative size-full overflow-hidden rounded-lg bg-[#0d2b1b] text-white">
        <RippleImage src={IMAGE} />
        <div className="absolute inset-0 bg-linear-to-t from-black/75 via-black/10 to-transparent" />
        <MoneyIn />
        <AgentAsk />
        <WorkflowRan />
        <h2 className="absolute right-10 bottom-10 left-10 max-w-md font-heading text-4xl leading-[1.1] font-medium tracking-tight text-balance">
          The workspace where people and AI get the work done.
        </h2>
      </div>
    </aside>
  );
}
