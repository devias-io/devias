import { useState } from 'react';
import { Avatar, AvatarFallback } from './components/ui/avatar';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';
import { Calendar } from './components/ui/calendar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card';
import { Checkbox } from './components/ui/checkbox';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from './components/ui/command';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { Input } from './components/ui/input';
import { Kbd } from './components/ui/kbd';
import { Label } from './components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from './components/ui/popover';
import { RadioGroup, RadioGroupItem } from './components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './components/ui/select';
import { Separator } from './components/ui/separator';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from './components/ui/sheet';
import { Skeleton } from './components/ui/skeleton';
import { Switch } from './components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Textarea } from './components/ui/textarea';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './components/ui/tooltip';
import { ICON_NAMES, Icon } from './icons';
import { EmptyState } from './layout/empty-state';
import { PageHeader, Section } from './layout/page';
import { SidebarNav } from './layout/sidebar-nav';
import { Toolbar } from './layout/toolbar';
import { useTheme } from './theme';

const Block = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <Section title={title} className="min-w-0">
    <div className="flex flex-wrap items-center gap-2">{children}</div>
  </Section>
);

/** Every primitive and layout component on one page, in light and dark. Mounted at /dev/ui in the studio. */
export function UiGallery() {
  const { theme, setTheme } = useTheme();
  const [date, setDate] = useState<Date | undefined>(new Date());

  return (
    <TooltipProvider>
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-6">
        <PageHeader
          title="UI gallery"
          description="Design tokens on shadcn/Base UI components."
          actions={
            <Select value={theme} onValueChange={(value) => setTheme(value as typeof theme)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">Light</SelectItem>
                <SelectItem value="dark">Dark</SelectItem>
                <SelectItem value="system">System</SelectItem>
              </SelectContent>
            </Select>
          }
        />

        <Block title="Buttons">
          <Button>Default</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">Destructive</Button>
          <Button variant="link">Link</Button>
          <Separator orientation="vertical" className="h-6" />
          <Button size="xs">Extra small</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon-sm" aria-label="Add">
            <Icon name="plus" />
          </Button>
          <Button disabled>Disabled</Button>
        </Block>

        <Block title="Inputs">
          <div className="flex w-56 flex-col gap-1">
            <Label htmlFor="g-name">Name</Label>
            <Input id="g-name" placeholder="Jane Doe" />
          </div>
          <div className="flex w-56 flex-col gap-1">
            <Label htmlFor="g-invalid">Invalid</Label>
            <Input id="g-invalid" aria-invalid defaultValue="not an email" />
          </div>
          <div className="flex w-72 flex-col gap-1">
            <Label htmlFor="g-notes">Notes</Label>
            <Textarea id="g-notes" placeholder="Multiline text" />
          </div>
          <Select defaultValue="meeting">
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="meeting">Meeting</SelectItem>
              <SelectItem value="customer">Customer</SelectItem>
            </SelectContent>
          </Select>
        </Block>

        <Block title="Choices">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox defaultChecked /> Checkbox
          </label>
          <label className="flex items-center gap-2 text-xs">
            <Switch defaultChecked /> Switch
          </label>
          <RadioGroup defaultValue="a" className="flex gap-3">
            <label className="flex items-center gap-2 text-xs">
              <RadioGroupItem value="a" /> Option A
            </label>
            <label className="flex items-center gap-2 text-xs">
              <RadioGroupItem value="b" /> Option B
            </label>
          </RadioGroup>
        </Block>

        <Block title="Overlays">
          <Dialog>
            <DialogTrigger render={<Button variant="outline" />}>Dialog</DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create person</DialogTitle>
                <DialogDescription>Dialogs use the popover surface and the default radius.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-1">
                <Label htmlFor="g-dialog-name">Name</Label>
                <Input id="g-dialog-name" autoFocus />
              </div>
              <DialogFooter>
                <Button>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Sheet>
            <SheetTrigger render={<Button variant="outline" />}>Sheet</SheetTrigger>
            <SheetContent>
              <SheetHeader>
                <SheetTitle>Record</SheetTitle>
                <SheetDescription>Side panels slide in from the right.</SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
          <Popover>
            <PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger>
            <PopoverContent className="w-64 text-xs">Popovers host filters and pickers.</PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger render={<Button variant="outline" />}>Tooltip</TooltipTrigger>
            <TooltipContent>
              Save <Kbd>⌘S</Kbd>
            </TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>Menu</DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem>
                <Icon name="pencil" /> Rename
              </DropdownMenuItem>
              <DropdownMenuItem>
                <Icon name="copy" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive">
                <Icon name="trash-2" /> Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Block>

        <Block title="Badges and avatars">
          <Badge>Default</Badge>
          <Badge variant="secondary">Secondary</Badge>
          <Badge variant="outline">Outline</Badge>
          <Badge variant="destructive">Destructive</Badge>
          <Avatar>
            <AvatarFallback>JD</AvatarFallback>
          </Avatar>
          <Avatar size="sm">
            <AvatarFallback>AB</AvatarFallback>
          </Avatar>
          <Skeleton className="h-6 w-24" />
        </Block>

        <Section title="Tabs">
          <Tabs defaultValue="overview">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="files">Files</TabsTrigger>
            </TabsList>
            <TabsContent value="overview" className="pt-3 text-xs text-muted-foreground">
              Overview tab content.
            </TabsContent>
            <TabsContent value="activity" className="pt-3 text-xs text-muted-foreground">
              Activity tab content.
            </TabsContent>
            <TabsContent value="files" className="pt-3 text-xs text-muted-foreground">
              Files tab content.
            </TabsContent>
          </Tabs>
        </Section>

        <Section title="Table" className="overflow-hidden">
          <Toolbar
            left={
              <>
                <Button variant="ghost" size="sm">
                  <Icon name="funnel" /> Filter
                </Button>
                <Button variant="ghost" size="sm">
                  <Icon name="arrow-up-down" /> Sort
                </Button>
              </>
            }
            right={
              <Button size="sm">
                <Icon name="plus" /> New
              </Button>
            }
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="text-right">Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[
                ['Acme renewal', 'Meeting', '€12,000'],
                ['Globex pilot', 'Proposal', '€48,500'],
                ['Initech onboarding', 'Customer', '€9,900'],
              ].map(([name, stage, amount]) => (
                <TableRow key={name}>
                  <TableCell className="font-medium">{name}</TableCell>
                  <TableCell>
                    <Badge variant="secondary">{stage}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{amount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Section title="Calendar">
            <Calendar mode="single" selected={date} onSelect={setDate} />
          </Section>
          <Section title="Command palette (inline)">
            <Command className="rounded-lg border border-border">
              <CommandInput placeholder="Type a command…" />
              <CommandList>
                <CommandEmpty>No results.</CommandEmpty>
                <CommandGroup heading="Navigate">
                  <CommandItem>
                    <Icon name="user" /> People <CommandShortcut>G P</CommandShortcut>
                  </CommandItem>
                  <CommandItem>
                    <Icon name="building-2" /> Companies <CommandShortcut>G C</CommandShortcut>
                  </CommandItem>
                </CommandGroup>
                <CommandGroup heading="Create">
                  <CommandItem>
                    <Icon name="user-plus" /> New person
                  </CommandItem>
                </CommandGroup>
              </CommandList>
            </Command>
          </Section>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Section title="Sidebar navigation" className="overflow-hidden">
            <div className="h-64 w-60 rounded-md border border-sidebar-border bg-sidebar">
              <SidebarNav
                groups={[
                  {
                    id: 'workspace',
                    title: 'Workspace',
                    items: [
                      { id: 'people', label: 'People', icon: 'user', href: '#', active: true },
                      { id: 'companies', label: 'Companies', icon: 'building-2', href: '#' },
                      { id: 'deals', label: 'Deals', icon: 'target', href: '#', badge: '12' },
                    ],
                  },
                  {
                    id: 'sales',
                    title: 'Sales',
                    items: [
                      {
                        id: 'pipeline',
                        label: 'Pipeline',
                        children: [
                          { id: 'q1', label: 'Q1 deals', href: '#' },
                          { id: 'q2', label: 'Q2 deals', href: '#' },
                        ],
                      },
                    ],
                  },
                ]}
              />
            </div>
          </Section>
          <Section title="Empty state">
            <EmptyState
              icon="inbox"
              title="No records yet"
              description="Records you create will show up here."
              action={
                <Button size="sm">
                  <Icon name="plus" /> New record
                </Button>
              }
            />
          </Section>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Icons</CardTitle>
            <CardDescription>{ICON_NAMES.length} curated Tabler icons available by name.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {ICON_NAMES.map((name) => (
                <Tooltip key={name}>
                  <TooltipTrigger
                    render={
                      <span className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground" />
                    }
                  >
                    <Icon name={name} />
                  </TooltipTrigger>
                  <TooltipContent>{name}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
