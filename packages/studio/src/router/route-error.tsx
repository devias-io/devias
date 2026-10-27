import { Button } from '@devias/ui';
import { type ErrorComponentProps, Link, useRouter } from '@tanstack/react-router';
import { ErrorPanel } from '../shell/error-panel';

/** The router's error component: a route failed to load or to render. Try again re-runs it. */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const router = useRouter();

  return (
    <ErrorPanel
      error={error}
      onRetry={() => {
        reset();
        void router.invalidate();
      }}
      actions={
        <Button variant="outline" size="lg" nativeButton={false} render={<Link to="/" />}>
          Go home
        </Button>
      }
    />
  );
}
