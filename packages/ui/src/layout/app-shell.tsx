import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, useRef, useState } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup, ResizeLine } from '../components/ui/resizable';
import { cn } from '../lib/cn';

/** How narrow and how wide the sidebar can be dragged, in pixels, and where its width is kept in this browser. */
const SIDEBAR_MIN = 192;
const SIDEBAR_MAX = 400;
/** `--sidebar-w` in styles.css, 15rem. */
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_KEY = 'devias:sidebar-width';

const readWidth = (): number | null => {
  try {
    const value = Number(window.localStorage.getItem(SIDEBAR_KEY));

    return Number.isFinite(value) && value >= SIDEBAR_MIN && value <= SIDEBAR_MAX ? value : null;
  } catch {
    return null;
  }
};

const writeWidth = (width: number | null) => {
  try {
    if (width === null) {
      window.localStorage.removeItem(SIDEBAR_KEY);
    } else {
      window.localStorage.setItem(SIDEBAR_KEY, String(width));
    }
  } catch {
    // The width is a convenience: without storage it lasts until the page is left.
  }
};

const clampWidth = (width: number) => Math.round(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, width)));

/** The grip on the sidebar's right edge: drag it (or use the arrow keys) to resize, double-click to put it back. */
function SidebarGrip({
  width,
  onResize,
}: {
  width: () => number;
  onResize: (width: number | null, commit: boolean) => void;
}) {
  const [active, setActive] = useState(false);
  const dragging = useRef(false);
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) {
      onResize(clampWidth(event.clientX), false);
    }
  };
  const end = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) {
      return;
    }

    dragging.current = false;
    setActive(false);
    onResize(clampWidth(event.clientX), true);
  };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }

    event.preventDefault();
    onResize(clampWidth(width() + (event.key === 'ArrowRight' ? 1 : -1) * (event.shiftKey ? 48 : 16)), true);
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable separator is the splitter pattern; <hr> cannot take focus or a value
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      aria-valuemin={SIDEBAR_MIN}
      aria-valuemax={SIDEBAR_MAX}
      aria-valuenow={Math.round(width())}
      tabIndex={0}
      data-slot="sidebar-grip"
      data-active={active ? '' : undefined}
      className="group/grip absolute inset-y-0 left-[calc(var(--sidebar-w)-0.5rem)] z-20 flex w-4 cursor-col-resize touch-none items-stretch justify-center outline-none"
      onPointerDown={(event) => {
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        dragging.current = true;
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

export interface AppShellPanel {
  /** Identifies the panel; each id gets its own resizable slot. */
  id: string;
  content: ReactNode;
  /** Sizes in percent of the area right of the sidebar. */
  defaultSize?: number;
  minSize?: number;
  maxSize?: number;
  onResize?: (percentage: number) => void;
}

export interface AppShellProps {
  sidebar?: ReactNode;
  topbar?: ReactNode;
  children?: ReactNode;
  /** A full-height, resizable panel docked on the right, beside both the top bar and the content. */
  panel?: AppShellPanel;
  sidebarCollapsed?: boolean;
  className?: string;
}

/**
 * The studio frame: a sidebar on the left (fixed width, or an icon rail when collapsed), a 44px top bar over a scrolling content area, and an
 * optional docked panel on the right. Geometry comes from the CSS variables in styles.css (`--sidebar-w`,
 * `--topbar-h`); the top bar is as tall as the sidebar header and the docked panel's header.
 */
export function AppShell({ sidebar, topbar, children, panel, sidebarCollapsed = false, className }: AppShellProps) {
  const [saved, setSaved] = useState<number | null>(readWidth);
  const [dragged, setDragged] = useState<number | null>(null);
  const shown = dragged ?? saved;
  const resize = (width: number | null, commit: boolean) => {
    if (!commit) {
      setDragged(width);

      return;
    }

    setDragged(null);
    setSaved(width);
    writeWidth(width);
  };

  return (
    <div
      data-slot="app-shell"
      data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
      className={cn(
        'relative grid h-dvh w-full overflow-hidden bg-background text-foreground',
        sidebarCollapsed ? 'grid-cols-[var(--sidebar-w-collapsed)_1fr]' : 'grid-cols-[var(--sidebar-w)_1fr]',
        className,
      )}
      style={shown === null ? undefined : ({ '--sidebar-w': `${shown}px` } as CSSProperties)}
    >
      {sidebarCollapsed ? null : <SidebarGrip width={() => shown ?? SIDEBAR_DEFAULT} onResize={resize} />}
      {/* The `shell` group is the sidebar alone: only what is in it collapses, not a sidebar of the page beside it. */}
      <aside
        data-slot="app-shell-sidebar"
        data-sidebar={sidebarCollapsed ? 'collapsed' : 'expanded'}
        className="group/shell flex h-full flex-col overflow-hidden border-r border-sidebar-border bg-sidebar text-sidebar-foreground"
      >
        {sidebar}
      </aside>
      {/* The group is always rendered so the content keeps its state when the panel opens or closes. */}
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 min-w-0">
        <ResizablePanel id="content" minSize="35">
          <div data-slot="app-shell-main" className="grid h-full grid-rows-[var(--topbar-h)_1fr]">
            <header
              data-slot="app-shell-topbar"
              className="flex h-[var(--topbar-h)] items-center border-b bg-background px-4 py-2"
            >
              {topbar}
            </header>
            <main data-slot="app-shell-content" className="relative min-h-0 overflow-auto">
              {children}
            </main>
          </div>
        </ResizablePanel>
        {panel ? (
          <>
            <ResizableHandle />
            <ResizablePanel
              id={`panel-${panel.id}`}
              defaultSize={`${panel.defaultSize ?? 32}`}
              minSize={`${panel.minSize ?? 20}`}
              maxSize={`${panel.maxSize ?? 65}`}
              onResize={panel.onResize ? (size) => panel.onResize?.(size.asPercentage) : undefined}
            >
              {panel.content}
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
    </div>
  );
}
