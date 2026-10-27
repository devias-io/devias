import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '../lib/cn';

export interface TrendPoint {
  /** What the point stands for, shown under its value on hover: "Mon 6 Oct", "Week of 29 Sep". */
  label: string;
  value: number;
}

export interface TrendChartProps {
  points: TrendPoint[];
  /** How a value reads on hover: a currency, a count. */
  format?: (value: number) => string;
  /** `signal` for the dark signal card (the bright lime), `default` for light and dark pages (the strong lime). */
  tone?: 'signal' | 'default';
  className?: string;
  'aria-label'?: string;
}

/** The chart's own inner margins, in pixels: room for the value above the highest point and the dot's halo. */
const PAD = { top: 44, right: 10, bottom: 8, left: 10 };
/** The value and its label at the top; the crosshair starts under them. */
const LABEL_H = 36;

/**
 * One series over time, as a 2px line over a fading wash, from a zero baseline. A crosshair snaps to the nearest
 * point under the pointer (or the arrow keys), with the point's value and label at its top; without a pointer the
 * latest point is shown. It fills its container, so give that a height.
 */
export function TrendChart({
  points,
  format = (value) => String(value),
  tone = 'default',
  className,
  'aria-label': ariaLabel,
}: TrendChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<number | null>(null);
  const gradient = useId();

  useEffect(() => {
    const element = box.current;

    if (!element) {
      return;
    }

    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  const geometry = useMemo(() => {
    const { width, height } = size;

    if (width === 0 || height === 0 || points.length === 0) {
      return null;
    }

    const max = Math.max(...points.map((point) => point.value), 0) || 1;
    const innerWidth = width - PAD.left - PAD.right;
    const innerHeight = height - PAD.top - PAD.bottom;
    const step = points.length > 1 ? innerWidth / (points.length - 1) : 0;
    const xy = points.map((point, index) => ({
      x: PAD.left + (points.length > 1 ? index * step : innerWidth / 2),
      y: PAD.top + innerHeight - (Math.max(point.value, 0) / max) * innerHeight,
    }));
    const line = xy.map(({ x, y }, index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const baseline = PAD.top + innerHeight;
    const first = xy[0] as { x: number };
    const last = xy[xy.length - 1] as { x: number };
    const area = `${line} L${last.x.toFixed(1)},${baseline} L${first.x.toFixed(1)},${baseline} Z`;

    return { xy, line, area, baseline, step };
  }, [points, size]);

  const shown = active ?? points.length - 1;
  const point = points[shown];
  const at = geometry?.xy[shown];

  const nearest = (event: PointerEvent<HTMLDivElement>) => {
    if (!geometry || points.length === 0) {
      return;
    }

    const x = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const index = geometry.step > 0 ? Math.round((x - PAD.left) / geometry.step) : 0;
    setActive(Math.min(points.length - 1, Math.max(0, index)));
  };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    const from = active ?? points.length - 1;
    setActive(Math.min(points.length - 1, Math.max(0, from + (event.key === 'ArrowLeft' ? -1 : 1))));
  };

  const signal = tone === 'signal';
  // The value sits at the top of the crosshair; near an edge it hangs inward so it is never cut.
  const anchor = !at ? 'center' : at.x < 56 ? 'start' : at.x > size.width - 56 ? 'end' : 'center';

  return (
    <div
      ref={box}
      role="img"
      aria-label={ariaLabel}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the arrow keys move between points
      tabIndex={0}
      data-slot="trend-chart"
      className={cn(
        'relative size-full min-h-0 cursor-crosshair touch-none outline-none focus-visible:ring-2 focus-visible:ring-brand/60',
        signal ? 'text-brand' : 'text-brand-strong',
        className,
      )}
      onPointerMove={nearest}
      onPointerLeave={() => setActive(null)}
      onKeyDown={keys}
      onBlur={() => setActive(null)}
    >
      {geometry ? (
        <svg width={size.width} height={size.height} className="absolute inset-0 overflow-visible" aria-hidden>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              {/* The wash is the brand lime itself, not a thinned line colour, so it stays fresh on a white page. */}
              <stop
                offset="0%"
                className={signal ? '[stop-opacity:0.28]' : '[stop-opacity:0.5] dark:[stop-opacity:0.18]'}
                style={{ stopColor: 'var(--brand)' }}
              />
              <stop offset="100%" stopOpacity={0} style={{ stopColor: 'var(--brand)' }} />
            </linearGradient>
          </defs>
          <path d={geometry.area} fill={`url(#${gradient})`} />
          <line
            x1={0}
            x2={size.width}
            y1={geometry.baseline + 0.5}
            y2={geometry.baseline + 0.5}
            className={signal ? 'stroke-white/10' : 'stroke-border'}
            strokeWidth={1}
          />
          <path
            d={geometry.line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {at ? (
            <>
              <line
                x1={at.x}
                x2={at.x}
                y1={LABEL_H}
                y2={geometry.baseline}
                stroke="currentColor"
                strokeWidth={1}
                className={signal ? 'text-brand/30' : 'text-foreground/15'}
              />
              <circle
                cx={at.x}
                cy={at.y}
                r={9}
                className={signal ? 'fill-brand/20' : 'fill-brand/45 dark:fill-brand/20'}
              />
              <circle
                cx={at.x}
                cy={at.y}
                r={4.5}
                fill="currentColor"
                className={signal ? 'stroke-signal' : 'stroke-card'}
                strokeWidth={2}
              />
            </>
          ) : null}
        </svg>
      ) : null}
      {point && at ? (
        <div
          className={cn(
            'pointer-events-none absolute top-0 flex flex-col whitespace-nowrap',
            anchor === 'center' && '-translate-x-1/2 items-center',
            anchor === 'start' && 'items-start',
            anchor === 'end' && '-translate-x-full items-end',
          )}
          style={{ left: anchor === 'start' ? at.x - 6 : anchor === 'end' ? at.x + 6 : at.x }}
          data-slot="trend-value"
        >
          <span className={cn('text-[14px] leading-5 font-semibold', !signal && 'text-foreground')}>
            {format(point.value)}
          </span>
          <span className={cn('text-[11px] leading-3', signal ? 'text-white/50' : 'text-muted-foreground')}>
            {point.label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
