import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AppShell,
  applyTheme,
  Badge,
  Button,
  EmptyState,
  getTheme,
  Icon,
  Input,
  OptionSelect,
  PageHeader,
  SidebarNav,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Toolbar,
} from '../src';

afterEach(cleanup);

// AppShell's resizable panel group observes its size; jsdom has no ResizeObserver.
if (typeof ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = ResizeObserverStub;
}

describe('@devias/ui smoke', () => {
  it('renders buttons, inputs and badges', () => {
    render(
      <div>
        <Button>Save</Button>
        <Button variant="outline" size="sm">
          Cancel
        </Button>
        <Input placeholder="Search" />
        <Badge>New</Badge>
        <Skeleton className="h-4 w-20" />
      </div>,
    );
    expect(screen.getByText('Save')).toBeTruthy();
    expect(screen.getByPlaceholderText('Search')).toBeTruthy();
    expect(screen.getByText('New')).toBeTruthy();
  });

  it('renders tabs', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Tab A</TabsTrigger>
          <TabsTrigger value="b">Tab B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Content A</TabsContent>
        <TabsContent value="b">Content B</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('Tab A')).toBeTruthy();
    expect(screen.getByText('Content A')).toBeTruthy();
  });

  it('renders icons with a fallback for unknown names', () => {
    const { container } = render(
      <div>
        <Icon name="user" />
        <Icon name="definitely-not-an-icon" />
      </div>,
    );
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });

  it('renders the app shell with sidebar navigation and layout primitives', () => {
    render(
      <AppShell
        sidebar={
          <SidebarNav
            groups={[
              {
                id: 'main',
                title: 'Workspace',
                items: [
                  { id: 'people', label: 'People', icon: 'user', href: '/people', active: true },
                  { id: 'sales', label: 'Sales', children: [{ id: 'deals', label: 'Deals', href: '/deals' }] },
                ],
              },
            ]}
          />
        }
        topbar={<Toolbar left={<span>Toolbar</span>} />}
      >
        <PageHeader title="People" description="All contacts" />
        <EmptyState title="Nothing here" description="Create your first record" />
      </AppShell>,
    );
    expect(screen.getByText('People', { selector: 'span' })).toBeTruthy();
    // A section starts closed; its row is there to open it.
    expect(screen.queryByText('Deals')).toBeNull();
    expect(screen.getByRole('button', { name: /Sales/ })).toBeTruthy();
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByRole('link', { name: /people/i }).getAttribute('href')).toBe('/people');
  });

  it('shows the chosen option of an OptionSelect, including an empty-string one', () => {
    const options = [
      { value: '', label: 'Never' },
      { value: '30', label: 'In 30 days' },
    ];
    const { rerender } = render(
      <OptionSelect aria-label="Expires" value="" onValueChange={() => {}} options={options} />,
    );
    expect(screen.getByRole('combobox', { name: 'Expires' }).textContent).toContain('Never');
    rerender(<OptionSelect aria-label="Expires" value="30" onValueChange={() => {}} options={options} />);
    expect(screen.getByRole('combobox', { name: 'Expires' }).textContent).toContain('In 30 days');
    rerender(
      <OptionSelect
        aria-label="Expires"
        value={null}
        placeholder="Pick one"
        onValueChange={() => {}}
        options={options}
      />,
    );
    expect(screen.getByRole('combobox', { name: 'Expires' }).textContent).toContain('Pick one');
  });

  it('docks a panel beside the top bar and content', () => {
    const { container } = render(
      <AppShell topbar={<span>Breadcrumbs</span>} panel={{ id: 'chat', content: <span>Chat</span> }}>
        <span>Content</span>
      </AppShell>,
    );
    const main = container.querySelector('[data-slot="app-shell-main"]');
    expect(main?.textContent).toContain('Breadcrumbs');
    expect(main?.textContent).toContain('Content');
    expect(main?.textContent).not.toContain('Chat');
    expect(screen.getByText('Chat')).toBeTruthy();
  });

  it('applies and persists the theme', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(getTheme()).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});
