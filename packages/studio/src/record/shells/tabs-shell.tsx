import { type LayoutTab, primaryFieldOf, type TabsLayout } from '@devias/core';
import { Breadcrumbs, Icon, Page, Tabs, TabsContent, TabsList, TabsTrigger } from '@devias/ui';
import { useMemo } from 'react';
import { recordLabel } from '../../providers/labels';
import { useSchema } from '../../providers/schema';
import { useWorkspace } from '../../providers/workspace';
import { useBlocks } from '../../registries';
import { links } from '../../router/links';
import { useNavigation } from '../../router/navigation';
import { BlockHost, LayoutRenderer, useVisibleCells } from '../layout-renderer';
import { withPlacedBlocks } from '../placement';
import { RecordActions } from '../record-actions';
import { RecordMenu } from '../record-menu';
import { useRecordPage } from '../record-page-context';
import type { ShellProps } from './types';

function RecordTabs({ tabs }: { tabs: LayoutTab[] }) {
  return (
    <TabsList variant="chip" className="overflow-x-auto [scrollbar-width:none]">
      {tabs.map((tab) => (
        <TabsTrigger key={tab.name} value={tab.name}>
          {tab.label}
        </TabsTrigger>
      ))}
    </TabsList>
  );
}

/**
 * The `tabs` shape: breadcrumbs and the actions on the first row, the header (the layout's `header` block, or the
 * icon and name), the tabs, then each tab's cells on a 12-column grid; blocks that place themselves are added where
 * they ask to be.
 */
export function TabsShell({ object, record, layout }: ShellProps<TabsLayout>) {
  const { index } = useSchema();
  const { slug } = useWorkspace();
  const navigation = useNavigation();
  const page = useRecordPage();
  const primaryField = primaryFieldOf(index, object);
  const blocks = useBlocks('record');
  const tabs = useMemo(() => withPlacedBlocks(layout, blocks, object), [layout, blocks, object]);
  const [header] = useVisibleCells(layout.header ? [layout.header] : []);
  const tabParam = String(navigation.search.tab ?? '');
  const activeTab = tabs.find((t) => t.name === tabParam)?.name ?? tabs[0]?.name ?? 'overview';
  const label = recordLabel(record, primaryField);
  const crumbs = [{ label: object.labelPlural, href: links.object(slug, object.nameSingular) }, { label }];

  return (
    <Page fullBleed className="bg-background">
      <Tabs
        className="flex-1 gap-0"
        value={activeTab}
        onValueChange={(value) =>
          navigation.navigate(links.record(slug, object.nameSingular, record.id, String(value)), { replace: true })
        }
      >
        {/* The header and the tabs share the column of the page below them. */}
        <div data-slot="record-header">
          <div className="mx-auto w-full max-w-[90rem] px-6 pt-4 sm:px-10">
            {/* The actions share the breadcrumbs' row, so the header below has the whole width. */}
            <div className="flex items-center justify-between gap-6">
              <Breadcrumbs items={crumbs} linkComponent={navigation.Link} className="-ml-1" />
              <div className="flex shrink-0 items-center gap-2">
                {/* Installed modules' actions, as the layout lists them: a button each, filled for the primary ones. */}
                <RecordActions entries={layout.actions} />
                <RecordMenu object={object} record={record} onDelete={page.requestDelete} />
              </div>
            </div>
            <div data-slot="page-header" className="mt-5">
              <div className="min-w-0">
                {header ? (
                  <BlockHost cell={header} record={record} object={object} />
                ) : (
                  <div className="flex min-w-0 items-center gap-3">
                    <span
                      data-slot="record-icon"
                      aria-hidden
                      className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-card-border"
                    >
                      <Icon name={object.icon ?? 'file'} className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <h1 className="truncate font-heading text-heading">{label}</h1>
                      <p className="mt-0.5 text-xs text-muted-foreground">{object.labelSingular}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
            {tabs.length > 1 ? (
              <div className="mt-6">
                <RecordTabs tabs={tabs} />
              </div>
            ) : null}
          </div>
        </div>
        <div className="@container mx-auto w-full max-w-[90rem] flex-1 px-6 pt-8 pb-10 sm:px-10">
          {tabs.map((tab) => (
            <TabsContent key={tab.name} value={tab.name}>
              <LayoutRenderer blocks={tab.blocks} record={record} object={object} />
            </TabsContent>
          ))}
        </div>
      </Tabs>
    </Page>
  );
}
