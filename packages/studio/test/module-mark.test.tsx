import type { DeviasClient } from '@devias/core';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ModuleMark } from '../src/components/module-mark';
import { createFakeClient, installLayoutStubs, recordsFixture, schemaFixture, TestProviders } from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

/** A client that serves logos from where the server does, as the HTTP client says. */
const withLogos = (): DeviasClient => {
  const client = createFakeClient(schemaFixture(), recordsFixture());

  return { ...client, modules: { ...client.modules, logoUrl: (id) => `http://api.test/api/modules/${id}/logo` } };
};
const inStudio = (client: DeviasClient, ui: React.ReactNode) => <TestProviders client={client}>{ui}</TestProviders>;

describe('ModuleMark', () => {
  it('fills its tile with the logo the module ships', () => {
    const { container } = render(
      inStudio(
        withLogos(),
        <ModuleMark moduleId="pay" module={{ logo: './logo.svg', icon: 'credit-card' }} tile className="size-10" />,
      ),
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('http://api.test/api/modules/pay/logo');
    expect(img?.className).toContain('size-full');
    expect(img?.parentElement?.className).toContain('size-10');
    expect(container.querySelector('svg')).toBeNull();
  });

  it('shows the line icon for a module with no logo, and the puzzle piece with no icon either', () => {
    const { container } = render(
      inStudio(
        withLogos(),
        <>
          <ModuleMark moduleId="a" module={{ icon: 'mail' }} tile className="size-10" />
          <ModuleMark moduleId="b" module={undefined} className="size-4" />
        </>,
      ),
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelectorAll('svg').length).toBe(2);
  });

  it('shows the line icon when the backend has no logos (the mock), and when the image fails to load', () => {
    const mock = render(
      inStudio(
        createFakeClient(schemaFixture(), recordsFixture()),
        <ModuleMark moduleId="pay" module={{ logo: './logo.svg', icon: 'credit-card' }} className="size-4" />,
      ),
    );
    expect(mock.container.querySelector('img')).toBeNull();
    expect(mock.container.querySelector('svg')).not.toBeNull();
    mock.unmount();

    const { container } = render(
      inStudio(
        withLogos(),
        <ModuleMark moduleId="pay" module={{ logo: './logo.svg', icon: 'credit-card' }} className="size-4" />,
      ),
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as Element);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
