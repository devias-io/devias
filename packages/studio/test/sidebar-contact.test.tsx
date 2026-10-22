import type { ContactLink } from '@devias/core';
import { createMockAuthAdapter } from '@devias/sdk/mock';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthProvider } from '../src/providers/auth';
import { StudioSidebar } from '../src/shell/sidebar';
import {
  createFakeClient,
  installLayoutStubs,
  recordsFixture,
  resolvedFixture,
  schemaFixture,
  TestProviders,
} from '../src/testing';

beforeAll(installLayoutStubs);
afterEach(cleanup);

const show = (contact?: ContactLink) => {
  const config = resolvedFixture(contact ? { contact } : {});

  return render(
    <AuthProvider value={createMockAuthAdapter()}>
      <TestProviders
        client={createFakeClient(schemaFixture(), recordsFixture())}
        schema={schemaFixture()}
        config={config}
      >
        <StudioSidebar structure={config.structure} />
      </TestProviders>
    </AuthProvider>,
  );
};

describe('the contact row in the sidebar', () => {
  it('sits right above Settings and opens the address it was given', () => {
    show({ href: 'mailto:team@acme.test?subject=Hello' });
    const link = screen.getByRole('link', { name: 'Get in touch' });
    expect(link.getAttribute('href')).toBe('mailto:team@acme.test?subject=Hello');
    // An address is not a page: no new tab.
    expect(link.getAttribute('target')).toBeNull();
    const settings = screen.getByRole('link', { name: 'Settings' });
    expect(link.compareDocumentPosition(settings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('opens a page in a new tab, and takes its own words', () => {
    show({ href: 'https://acme.test/contact', label: 'Talk to us' });
    const link = screen.getByRole('link', { name: 'Talk to us' });
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toContain('noreferrer');
    expect(screen.queryByRole('link', { name: 'Get in touch' })).toBeNull();
  });

  it('is not there when the app does not give a way to reach it', () => {
    show();
    expect(screen.queryByRole('link', { name: 'Get in touch' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' })).toBeTruthy();
  });
});
