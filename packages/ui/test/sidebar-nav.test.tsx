import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SidebarNav, type SidebarNavGroup } from '../src';

afterEach(cleanup);

const groups = (activeChild = false): SidebarNavGroup[] => [
  {
    id: 'main',
    items: [
      { id: 'home', label: 'Home', icon: 'house', href: '/' },
      {
        id: 'engage',
        label: 'Engage',
        icon: 'send',
        children: [
          { id: 'sequences', label: 'Sequences', href: '/sequences' },
          { id: 'emails', label: 'Emails', href: '/emails', active: activeChild },
        ],
      },
    ],
  },
];

describe('SidebarNav sub menus', () => {
  it('starts a section closed, opens and closes it from its row, children without icons beneath it', () => {
    render(<SidebarNav groups={groups()} />);
    expect(screen.queryByText('Sequences')).toBeNull();
    const row = screen.getByRole('button', { name: /Engage/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(row);
    expect(screen.getByText('Sequences')).toBeTruthy();
    expect(row.getAttribute('aria-expanded')).toBe('true');
    // The parent keeps its icon; the children are plain labels.
    expect(row.querySelector('svg')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sequences' }).querySelector('svg')).toBeNull();
    fireEvent.click(row);
    expect(screen.queryByText('Sequences')).toBeNull();
  });

  it('opens a closed section by itself when the page you are on is inside it', () => {
    render(<SidebarNav groups={groups(true)} />);
    expect(screen.getByText('Emails')).toBeTruthy();
  });
});

describe('SidebarNav sections that ask to start open', () => {
  it('honours defaultOpen: true', () => {
    render(
      <SidebarNav
        groups={[
          {
            id: 'main',
            items: [
              {
                id: 'sales',
                label: 'Sales',
                defaultOpen: true,
                children: [{ id: 'deals', label: 'Deals', href: '/d' }],
              },
            ],
          },
        ]}
      />,
    );
    expect(screen.getByText('Deals')).toBeTruthy();
  });
});
