import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorBoundary } from '../src/shell/error-boundary';
import { ErrorPanel } from '../src/shell/error-panel';

afterEach(cleanup);

describe('ErrorPanel', () => {
  it('says what happened, offers a way forward and folds the technical details away', () => {
    const retry = vi.fn();
    const error = new Error('useSchema must be used inside a workspace route');
    render(<ErrorPanel error={error} onRetry={retry} />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Something went wrong' })).toBeTruthy();
    expect(screen.getAllByText(/useSchema must be used inside a workspace route/).length).toBeGreaterThan(0);
    const details = document.querySelector('details') as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('Copy details');
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});

describe('ErrorBoundary', () => {
  it('shows the panel for a component that throws, and recovers when it stops throwing', () => {
    let broken = true;
    const Child = () => {
      if (broken) {
        throw new Error('boom');
      }

      return <p>fine</p>;
    };
    const silence = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary title="Records failed to render">
        <Child />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('heading', { name: 'Records failed to render' })).toBeTruthy();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(screen.getByText('fine')).toBeTruthy();
    silence.mockRestore();
  });
});
