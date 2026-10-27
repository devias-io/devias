import { defineSettingsSection } from '@devias/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsSectionPage } from '../src/pages/settings';
import { createStaticNavigation } from '../src/router/navigation';
import { createFakeClient, recordsFixture, resolvedFixture, schemaFixture, TestProviders } from '../src/testing';

afterEach(cleanup);

const things = (detail: boolean) =>
  defineSettingsSection({ name: 'things', label: 'Things', detail, component: () => <p>the body</p> });

const show = (detail: boolean, item?: string) =>
  render(
    <TestProviders
      client={createFakeClient(schemaFixture(), recordsFixture())}
      schema={schemaFixture()}
      config={resolvedFixture({ settingsSections: [things(detail)] })}
      navigation={createStaticNavigation(
        `/workspaces/acme/settings/things${item ? `/${item}` : ''}`,
        {},
        { section: 'things', ...(item ? { item } : {}) },
      )}
    >
      <SettingsSectionPage />
    </TestProviders>,
  );

describe('a settings section page for one item', () => {
  it('leaves out the section title when the section draws its own header for items', () => {
    show(true, 'one');
    expect(screen.getByText('the body')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Things' })).toBeNull();
  });

  it('keeps the title on the section itself, and on any page when the section has no detail pages', () => {
    show(true);
    expect(screen.getByRole('heading', { name: 'Things' })).toBeTruthy();
    cleanup();
    show(false, 'one');
    expect(screen.getByRole('heading', { name: 'Things' })).toBeTruthy();
  });
});
