import { Button } from '@devias/ui';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorPanel } from './error-panel';

interface Props {
  children: ReactNode;
  title?: string;
  /** Compact rendering for blocks. */
  compact?: boolean;
  /** Drawn instead of the error when something below fails, for a part that has a plain version to fall back to. */
  fallback?: ReactNode;
}

interface State {
  error: Error | null;
}

/** Catches render errors per page and per widget so one broken module never takes the studio down. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    if (typeof console !== 'undefined') {
      console.error('[studio] render error', error, info.componentStack);
    }
  }

  private reset = () => this.setState({ error: null });

  override render(): ReactNode {
    const { error } = this.state;

    if (!error) {
      return this.props.children;
    }

    if (this.props.fallback !== undefined) {
      return this.props.fallback;
    }

    if (this.props.compact) {
      return (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
          <div className="font-medium">{this.props.title ?? 'This widget failed to render'}</div>
          <div className="mt-1 break-words text-destructive/80">{error.message}</div>
          <Button size="xs" variant="outline" className="mt-2" onClick={this.reset}>
            Try again
          </Button>
        </div>
      );
    }

    return (
      <ErrorPanel
        title={this.props.title ?? 'Something went wrong'}
        description="This part of the studio failed to render. The rest still works: try again, or open something else."
        error={error}
        onRetry={this.reset}
      />
    );
  }
}
