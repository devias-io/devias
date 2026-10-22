import { cn, ResizeLine } from '@devias/ui';
import { type KeyboardEvent, type PointerEvent, useRef, useState } from 'react';

/** How narrow and how wide a rail (the aside beside a page's main column) can be dragged, in pixels. */
export const RAIL_MIN = 280;
export const RAIL_MAX = 640;
/** What the main column keeps for itself when the rail grows, and the gap between them. */
const MAIN_MIN = 360;
const COLUMN_GAP = 40;

const read = (key: string): number | null => {
  try {
    const value = Number(window.localStorage.getItem(key));

    return Number.isFinite(value) && value >= RAIL_MIN ? value : null;
  } catch {
    return null;
  }
};

const write = (key: string, width: number | null) => {
  try {
    if (width === null) {
      window.localStorage.removeItem(key);
    } else {
      window.localStorage.setItem(key, String(Math.round(width)));
    }
  } catch {
    // The width is a convenience: without storage it lasts until the page is left.
  }
};

/**
 * The width a person gave a rail, kept in this browser under `storageKey`: `shown` is what to draw (the width being
 * dragged, else the saved one, else null for the layout's own), and `resize` is what the grip calls (`commit` ends the
 * drag and saves it; `null` puts the width back).
 */
export function useRailWidth(storageKey: string) {
  const [saved, setSaved] = useState<number | null>(() => read(storageKey));
  const [dragging, setDragging] = useState<number | null>(null);
  const resize = (width: number | null, commit: boolean) => {
    if (!commit) {
      setDragging(width);

      return;
    }

    setDragging(null);
    setSaved(width);
    write(storageKey, width);
  };

  return { shown: dragging ?? saved, resize };
}

/**
 * The grip on the left edge of a rail: drag it (or use the arrow keys) to make the rail wider or narrower, double-click
 * to put it back. It only shows a line over the rail's border while it is hovered or held. `gridRef` is the box holding both columns, which
 * keeps the main column from being squeezed; `className` says where the grip sits against the rail's edge.
 */
export function RailGrip({
  width,
  gridRef,
  onResize,
  className,
}: {
  width: () => number;
  gridRef: { current: HTMLElement | null };
  onResize: (width: number | null, commit: boolean) => void;
  className?: string;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const [active, setActive] = useState(false);
  const clamp = (value: number) => {
    const room = (gridRef.current?.clientWidth ?? RAIL_MAX + MAIN_MIN + COLUMN_GAP) - MAIN_MIN - COLUMN_GAP;

    return Math.round(Math.max(RAIL_MIN, Math.min(RAIL_MAX, room, value)));
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      onResize(clamp(drag.current.width + drag.current.x - event.clientX), false);
    }
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) {
      return;
    }

    onResize(clamp(drag.current.width + drag.current.x - event.clientX), true);
    drag.current = null;
    setActive(false);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 48 : 16;

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    onResize(clamp(width() + (event.key === 'ArrowLeft' ? step : -step)), true);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the splitter pattern; <hr> cannot take focus or a value
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details"
      aria-valuemin={RAIL_MIN}
      aria-valuemax={RAIL_MAX}
      aria-valuenow={Math.round(width())}
      tabIndex={0}
      data-slot="rail-grip"
      data-active={active ? '' : undefined}
      className={cn(
        'group/grip absolute inset-y-0 z-10 hidden w-4 cursor-col-resize touch-none items-stretch justify-center outline-none @3xl:flex',
        className,
      )}
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: width() };
        setActive(true);
      }}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={() => onResize(null, true)}
      onKeyDown={key}
    >
      <ResizeLine />
    </div>
  );
}
