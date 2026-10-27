import type { BlockDefinition } from '@devias/core';
import { AppShell, TooltipProvider } from '@devias/ui';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { createSequenceMatcher, type KeyBinding } from '../commands/keybindings';
import { useStudioConfig } from '../providers/studio-config';
import { useBlocks } from '../registries';
import { useNavigation } from '../router/navigation';
import { readPanelSize, useDock, writePanelSize } from './dock';
import { DriftBanner } from './drift-banner';
import { ErrorBoundary } from './error-boundary';
import { NotificationToasts } from './notifications/notification-toasts';
import { ShellProvider } from './shell-context';
import { StudioSidebar } from './sidebar';
import { StudioTopbar } from './topbar';

/** A block docked next to the routed content (e.g. the agent), resizable and error-isolated. */
function DockedPanel({ block }: { block: BlockDefinition }) {
  const Component = block.component;

  return (
    <aside data-slot="docked-panel" data-panel={block.id} className="flex h-full min-h-0 flex-col bg-background">
      <ErrorBoundary title={`${block.label} failed to render`}>
        <Component config={{}} surface="panel" />
      </ErrorBoundary>
    </aside>
  );
}

/** Panel blocks' shortcuts toggle them from anywhere in the workspace. */
const usePanelShortcuts = (panels: BlockDefinition[]) => {
  const toggle = useDock((state) => state.toggle);
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const bindings: KeyBinding[] = panels.flatMap((block) => {
      const shortcut = block.surfaces.panel?.shortcut;

      return shortcut ? [{ keys: shortcut, global: true, run: () => toggle(block.id) }] : [];
    });

    if (bindings.length === 0) {
      return;
    }

    const matcher = createSequenceMatcher(bindings);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return;
      }

      if (matcher.handle(event)) {
        event.preventDefault();
      }
    };
    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panels, toggle]);
};

function ShellFrame({ children }: { children?: ReactNode }) {
  const config = useStudioConfig();
  const navigation = useNavigation();
  const [sidebarCollapsed, setCollapsed] = useState(false);
  const shell = useMemo(() => ({ sidebarCollapsed, toggleSidebar: () => setCollapsed((v) => !v) }), [sidebarCollapsed]);
  const panels = useBlocks('panel');
  usePanelShortcuts(panels);
  const openId = useDock((state) => state.openId);
  const panel = openId ? panels.find((block) => block.id === openId) : undefined;

  return (
    <ShellProvider value={shell}>
      <AppShell
        sidebar={<StudioSidebar structure={config.structure} />}
        topbar={<StudioTopbar />}
        sidebarCollapsed={sidebarCollapsed}
        panel={
          panel
            ? {
                id: panel.id,
                content: <DockedPanel block={panel} />,
                defaultSize: readPanelSize(panel.id) ?? panel.surfaces.panel?.defaultSize,
                minSize: panel.surfaces.panel?.minSize,
                onResize: (size) => writePanelSize(panel.id, size),
              }
            : undefined
        }
      >
        <div className="flex h-full min-h-0 flex-col">
          <DriftBanner />
          <NotificationToasts />
          {/* Positioned, so absolute bits of a page (e.g. screen-reader-only labels) scroll with it and never stretch the shell. */}
          <div className="relative min-h-0 flex-1 overflow-auto">
            <ErrorBoundary key={navigation.pathname}>{children}</ErrorBoundary>
          </div>
        </div>
      </AppShell>
    </ShellProvider>
  );
}

/** The workspace frame: sidebar + top bar + routed content (+ an optional docked panel). */
export function StudioShell({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <ShellFrame>{children}</ShellFrame>
    </TooltipProvider>
  );
}
