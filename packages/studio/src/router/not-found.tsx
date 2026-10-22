import { BrandLockup, Button, Icon } from '@devias/ui';
import { Link, useLocation } from '@tanstack/react-router';
import { useWorkspace } from '../providers/workspace';
import { links } from './links';

/** What a missing address looks like: a big 404, what was asked for, and two ways out. */
function NotFoundContent({ homeHref, homeLabel }: { homeHref: string; homeLabel: string }) {
  const location = useLocation();

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center" data-slot="not-found">
      <div
        className="font-heading text-[6rem] leading-none font-semibold tracking-tighter text-muted-foreground/25 select-none sm:text-[8rem]"
        aria-hidden="true"
      >
        404
      </div>
      <h1 className="mt-8 font-heading text-xl font-semibold tracking-tight">This page doesn’t exist</h1>
      <p className="mt-3 max-w-sm text-xs leading-relaxed text-muted-foreground">
        The address may be mistyped, or the page was moved or deleted.
      </p>
      <code className="mt-8 max-w-full truncate rounded-md border border-border bg-muted/50 px-2.5 py-1 font-mono text-xs text-muted-foreground">
        {location.pathname}
      </code>
      <div className="mt-10 flex items-center gap-3">
        <Button variant="outline" onClick={() => window.history.back()}>
          <Icon name="arrow-left" className="size-3.5" /> Go back
        </Button>
        <Button nativeButton={false} render={<Link to={homeHref} />}>
          {homeLabel}
        </Button>
      </div>
    </div>
  );
}

/** Outside any workspace: a page of its own, with the brand on top. */
export function NotFoundPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-background px-6 py-8 text-foreground sm:px-12">
      <BrandLockup wordmarkClassName="h-[18px]" />
      <NotFoundContent homeHref="/" homeLabel="Go home" />
    </div>
  );
}

/** Inside a workspace: fills the content area, and home is the workspace's own. */
export function WorkspaceNotFoundPage() {
  const { slug } = useWorkspace();

  return <NotFoundContent homeHref={links.workspace(slug)} homeLabel="Go to home" />;
}
