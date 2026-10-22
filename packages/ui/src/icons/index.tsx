import {
  IconActivity,
  IconAdjustmentsHorizontal,
  IconAlertCircle,
  IconAlertTriangle,
  IconAlignLeft,
  IconArchive,
  IconArrowBackUp,
  IconArrowDown,
  IconArrowForwardUp,
  IconArrowLeft,
  IconArrowRight,
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconArrowsUpDown,
  IconArrowUp,
  IconAt,
  IconBell,
  IconBinary,
  IconBolt,
  IconBook,
  IconBookmark,
  IconBox,
  IconBoxMultiple,
  IconBraces,
  IconBrandGithub,
  IconBrandLinkedin,
  IconBrandX,
  IconBriefcase,
  IconBuilding,
  IconCalendar,
  IconCalendarCheck,
  IconCalendarEvent,
  IconCalendarTime,
  IconChartBar,
  IconChartLine,
  IconChartPie,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconCircle,
  IconCircleCheck,
  IconCircleCheckFilled,
  IconCircleDot,
  IconCircleX,
  IconCircleXFilled,
  IconClock,
  IconCode,
  IconCoins,
  IconColumns3,
  IconCommand,
  type Icon as IconComponentType,
  IconCopy,
  IconCornerDownLeft,
  IconCreditCard,
  IconCurrencyDollar,
  IconDatabase,
  IconDeviceDesktop,
  IconDeviceFloppy,
  IconDots,
  IconDotsVertical,
  IconDownload,
  IconEdit,
  IconExternalLink,
  IconEye,
  IconEyeOff,
  IconFile,
  IconFileText,
  IconFilter,
  IconFlag,
  IconFolder,
  IconGripVertical,
  IconHash,
  IconHeart,
  IconHelpCircle,
  IconHierarchy2,
  IconHistory,
  IconHome,
  IconId,
  IconInbox,
  IconInfoCircle,
  IconKey,
  IconLayoutGrid,
  IconLayoutKanban,
  IconLayoutRows,
  IconLayoutSidebar,
  IconLifebuoy,
  IconLink,
  IconList,
  IconListCheck,
  IconListDetails,
  IconLoader2,
  IconLock,
  IconLogin,
  IconLogout,
  IconMail,
  IconMapPin,
  IconMessage,
  IconMinus,
  IconMoon,
  IconNote,
  IconPackage,
  IconPaperclip,
  IconPencil,
  IconPercentage,
  IconPhone,
  IconPhoto,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlug,
  IconPlus,
  IconPuzzle,
  IconReceipt,
  IconRefresh,
  IconRobot,
  IconRotate,
  IconSearch,
  IconSelector,
  IconSettings,
  IconShieldCheck,
  IconSparkles,
  IconSquareCheck,
  IconStack2,
  IconStar,
  IconSun,
  IconTable,
  IconTag,
  IconTags,
  IconTarget,
  IconTerminal2,
  IconThumbUp,
  IconToggleLeft,
  IconToggleRight,
  IconTool,
  IconTrash,
  IconTrendingUp,
  IconTruck,
  IconTypography,
  IconUpload,
  IconUser,
  IconUserPlus,
  IconUsers,
  IconWallet,
  IconWorld,
  IconX,
  type IconProps as TablerIconProps,
} from '@tabler/icons-react';
import type { ComponentType, SVGAttributes } from 'react';
import { cn } from '../lib/cn';

/** The cut of an icon: the outline everywhere, or a solid one where the set has it (see `FILLED_ICONS`). */
export type IconWeight = 'regular' | 'fill';

/** Any SVG icon component: the built-in Tabler set, or one a module registers. */
export type IconComponent = IconComponentType | ComponentType<SVGAttributes<SVGElement> & { size?: number | string }>;

/**
 * A curated, statically imported icon map (tree-shakable). Icons are addressed by kebab-case name so
 * metadata, manifests and modules can reference them as strings. Everything is Tabler (outline), keyed by the
 * lucide-style names the metadata already uses. Unknown names render `circle`.
 */
const BUILTIN_ICONS = {
  activity: IconActivity,
  'arrow-down': IconArrowDown,
  'arrow-left': IconArrowLeft,
  'arrow-right': IconArrowRight,
  'arrow-up': IconArrowUp,
  'arrow-up-down': IconArrowsUpDown,
  agent: IconSparkles,
  archive: IconArchive,
  'at-sign': IconAt,
  bell: IconBell,
  binary: IconBinary,
  'book-open': IconBook,
  bookmark: IconBookmark,
  bot: IconRobot,
  box: IconBox,
  boxes: IconBoxMultiple,
  braces: IconBraces,
  briefcase: IconBriefcase,
  'building-2': IconBuilding,
  calendar: IconCalendar,
  'calendar-check': IconCalendarCheck,
  'calendar-clock': IconCalendarTime,
  'calendar-days': IconCalendarEvent,
  'chart-bar': IconChartBar,
  'bar-chart-3': IconChartBar,
  'chart-line': IconChartLine,
  'chart-pie': IconChartPie,
  check: IconCheck,
  'check-square': IconSquareCheck,
  'square-check': IconSquareCheck,
  'chevron-down': IconChevronDown,
  'chevron-left': IconChevronLeft,
  'chevron-right': IconChevronRight,
  'chevron-up': IconChevronUp,
  'chevrons-up-down': IconSelector,
  circle: IconCircle,
  'circle-alert': IconAlertCircle,
  'alert-circle': IconAlertCircle,
  'circle-check': IconCircleCheck,
  'circle-dot': IconCircleDot,
  'circle-help': IconHelpCircle,
  'help-circle': IconHelpCircle,
  'circle-x': IconCircleX,
  clock: IconClock,
  coins: IconCoins,
  code: IconCode,
  'columns-3': IconColumns3,
  command: IconCommand,
  contact: IconId,
  copy: IconCopy,
  'corner-down-left': IconCornerDownLeft,
  'credit-card': IconCreditCard,
  database: IconDatabase,
  'dollar-sign': IconCurrencyDollar,
  download: IconDownload,
  ellipsis: IconDots,
  'more-horizontal': IconDots,
  'ellipsis-vertical': IconDotsVertical,
  'more-vertical': IconDotsVertical,
  'external-link': IconExternalLink,
  eye: IconEye,
  'eye-off': IconEyeOff,
  file: IconFile,
  'file-text': IconFileText,
  flag: IconFlag,
  folder: IconFolder,
  funnel: IconFilter,
  filter: IconFilter,
  github: IconBrandGithub,
  globe: IconWorld,
  'grip-vertical': IconGripVertical,
  hash: IconHash,
  heart: IconHeart,
  history: IconHistory,
  house: IconHome,
  home: IconHome,
  image: IconPhoto,
  inbox: IconInbox,
  info: IconInfoCircle,
  kanban: IconLayoutKanban,
  key: IconKey,
  layers: IconStack2,
  'layout-grid': IconLayoutGrid,
  'life-buoy': IconLifebuoy,
  link: IconLink,
  linkedin: IconBrandLinkedin,
  list: IconList,
  'list-bullets': IconListDetails,
  'list-checks': IconListCheck,
  'loader-circle': IconLoader2,
  'loader-2': IconLoader2,
  lock: IconLock,
  'log-in': IconLogin,
  'log-out': IconLogout,
  mail: IconMail,
  'map-pin': IconMapPin,
  'maximize-2': IconArrowsMaximize,
  'message-square': IconMessage,
  'minimize-2': IconArrowsMinimize,
  minus: IconMinus,
  monitor: IconDeviceDesktop,
  moon: IconMoon,
  'octagon-x': IconCircleX,
  package: IconPackage,
  'panel-left': IconLayoutSidebar,
  'panel-left-close': IconLayoutSidebar,
  paperclip: IconPaperclip,
  pause: IconPlayerPause,
  pencil: IconPencil,
  percent: IconPercentage,
  phone: IconPhone,
  play: IconPlayerPlay,
  plug: IconPlug,
  plus: IconPlus,
  puzzle: IconPuzzle,
  receipt: IconReceipt,
  redo: IconArrowForwardUp,
  'refresh-cw': IconRefresh,
  'rotate-ccw': IconRotate,
  'rows-3': IconLayoutRows,
  save: IconDeviceFloppy,
  search: IconSearch,
  settings: IconSettings,
  'settings-2': IconAdjustmentsHorizontal,
  shield: IconShieldCheck,
  'sliders-horizontal': IconAdjustmentsHorizontal,
  sparkles: IconSparkles,
  'square-pen': IconEdit,
  star: IconStar,
  'sticky-note': IconNote,
  sun: IconSun,
  table: IconTable,
  tag: IconTag,
  tags: IconTags,
  target: IconTarget,
  terminal: IconTerminal2,
  text: IconAlignLeft,
  'thumbs-up': IconThumbUp,
  'toggle-left': IconToggleLeft,
  'toggle-right': IconToggleRight,
  'trash-2': IconTrash,
  'trending-up': IconTrendingUp,
  'triangle-alert': IconAlertTriangle,
  'alert-triangle': IconAlertTriangle,
  truck: IconTruck,
  type: IconTypography,
  undo: IconArrowBackUp,
  upload: IconUpload,
  user: IconUser,
  'user-plus': IconUserPlus,
  users: IconUsers,
  wallet: IconWallet,
  workflow: IconHierarchy2,
  wrench: IconTool,
  x: IconX,
  'x-logo': IconBrandX,
  zap: IconBolt,
} satisfies Record<string, IconComponent>;

/** The solid cut of the icons that have one, for `weight="fill"` (status marks, mostly). */
const FILLED_ICONS: Partial<Record<keyof typeof BUILTIN_ICONS, IconComponent>> = {
  'circle-check': IconCircleCheckFilled,
  'circle-x': IconCircleXFilled,
  'octagon-x': IconCircleXFilled,
};

export type BuiltinIconName = keyof typeof BUILTIN_ICONS;
export type IconName = BuiltinIconName | (string & {});

const registry = new Map<string, IconComponent>(Object.entries(BUILTIN_ICONS));
const warned = new Set<string>();

/** Extend the icon set (modules call this once at load). */
export const registerIcons = (icons: Record<string, IconComponent>): void => {
  for (const [name, component] of Object.entries(icons)) {
    registry.set(name, component);
  }
};

export const resolveIcon = (name: IconName | undefined, weight?: IconWeight): IconComponent => {
  if (!name) {
    return BUILTIN_ICONS.circle;
  }

  const icon = registry.get(name);

  if (icon) {
    // A module that replaced a built-in name keeps its own icon in every weight.
    const filled =
      weight === 'fill' && icon === BUILTIN_ICONS[name as BuiltinIconName]
        ? FILLED_ICONS[name as BuiltinIconName]
        : undefined;

    return filled ?? icon;
  }

  if (!warned.has(name)) {
    warned.add(name);

    if (typeof console !== 'undefined') {
      console.warn(`[ui] unknown icon "${name}", rendering a circle`);
    }
  }

  return BUILTIN_ICONS.circle;
};

export const ICON_NAMES = Object.keys(BUILTIN_ICONS) as BuiltinIconName[];

export interface IconProps extends Omit<TablerIconProps, 'ref'> {
  name: IconName;
  size?: number | string;
  /** The outline unless a place asks for `fill`; icons without a solid cut stay outlined. */
  weight?: IconWeight;
}

export function Icon({ name, size = 16, weight, className, ...props }: IconProps) {
  const Component = resolveIcon(name, weight) as IconComponentType;

  return <Component data-icon={name} size={size} aria-hidden className={cn('shrink-0', className)} {...props} />;
}
