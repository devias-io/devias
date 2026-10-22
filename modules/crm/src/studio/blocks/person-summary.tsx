import { defineBlockComponent, type ObjectMetadata, type RecordData } from '@devias/core';
import {
  links as appLinks,
  externalHref,
  useFields,
  useNavigation,
  useRelatedLabels,
  useWorkspace,
} from '@devias/studio';
import { Avatar, AvatarFallback, Badge, Icon, type IconName } from '@devias/ui';
import { useEffect, useState } from 'react';
import { ids } from '../../manifest';
import { META, META_LINK } from '../shared';

const initials = (first: unknown, last: unknown) =>
  [first, last]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .map((v) => v[0]?.toUpperCase())
    .join('') || '?';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** The person's profiles and sites, in the order they show. */
const LINKS: { field: string; label: string; icon: IconName }[] = [
  { field: 'linkedin', label: 'LinkedIn', icon: 'linkedin' },
  { field: 'twitter', label: 'X', icon: 'x-logo' },
  { field: 'github', label: 'GitHub', icon: 'github' },
  { field: 'website', label: 'Website', icon: 'globe' },
];

/** The time in `zone` and how far it is from the viewer's; null for a name the browser does not know. */
export const localTime = (zone: string, now: Date): { time: string; offset: string } | null => {
  try {
    const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: zone }).format(now);
    // The wall clock of each zone read back in one zone: their difference is the gap between the two.
    const wall = (timeZone?: string) => new Date(now.toLocaleString('en-US', { timeZone }));
    const hours = Math.round((wall(zone).getTime() - wall().getTime()) / 1_800_000) / 2;
    const offset = hours === 0 ? 'same time as you' : `${Math.abs(hours)}h ${hours > 0 ? 'ahead' : 'behind'}`;

    return { time, offset };
  } catch {
    return null;
  }
};

function LocalTime({ zone }: { zone: string }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);

    return () => clearInterval(timer);
  }, []);
  const local = localTime(zone, now);

  if (!local) {
    return null;
  }

  return (
    <span className={META} data-slot="local-time">
      <Icon name="clock" /> {local.time} · {local.offset}
    </span>
  );
}

function PersonSummary({ record, object }: { record?: RecordData; object?: ObjectMetadata }) {
  const { slug } = useWorkspace();
  const { Link } = useNavigation();
  const companyId = text(record?.company);
  const company = useRelatedLabels('company', [companyId]);
  const fields = useFields(object?.id ?? '');

  if (!record) {
    return <div className="text-xs text-muted-foreground">No record.</div>;
  }

  const name = [text(record.first_name), text(record.last_name)].filter(Boolean).join(' ') || record.id;
  const jobTitle = text(record.job_title);
  const email = text(record.email);
  const phone = text(record.phone);
  const place = [text(record.city), text(record.country)].filter(Boolean).join(', ');
  const zone = text(record.time_zone);
  const stage = (
    fields.find((field) => field.name === 'stage')?.settings as
      | { options?: { value: string; label: string }[] }
      | undefined
  )?.options?.find((option) => option.value === record.stage)?.label;
  const links = LINKS.flatMap((link) => {
    const value = text(record[link.field]);

    return value ? [{ ...link, href: externalHref(value.trim()) }] : [];
  });

  return (
    <div data-slot="person-summary">
      <div className="flex items-center gap-3.5">
        <Avatar className="size-11">
          <AvatarFallback className="bg-secondary text-xs font-medium text-foreground">
            {initials(record.first_name, record.last_name)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2.5">
            <h1 className="truncate font-heading text-heading">{name}</h1>
            {stage ? (
              <Badge variant="secondary" className="h-6 shrink-0 px-2.5" data-slot="person-stage">
                {stage}
              </Badge>
            ) : null}
          </div>
          {jobTitle || companyId ? (
            <p className="text-xs text-muted-foreground">
              {jobTitle}
              {jobTitle && companyId ? ' at ' : null}
              {companyId ? (
                <Link
                  href={appLinks.record(slug, 'company', companyId)}
                  className="font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-foreground"
                >
                  {company.get(companyId)}
                </Link>
              ) : null}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">
        {email ? (
          <a href={`mailto:${email}`} className={META_LINK}>
            <Icon name="mail" /> {email}
          </a>
        ) : null}
        {phone ? (
          <a href={`tel:${phone}`} className={META_LINK}>
            <Icon name="phone" /> {phone}
          </a>
        ) : null}
        {place ? (
          <span className={META}>
            <Icon name="map-pin" /> {place}
          </span>
        ) : null}
        {zone ? <LocalTime zone={zone} /> : null}
        {links.map((link) => (
          <a
            key={link.field}
            href={link.href}
            target="_blank"
            rel="noreferrer noopener"
            data-slot="person-link"
            className={META_LINK}
          >
            <Icon name={link.icon} /> {link.label}
          </a>
        ))}
      </div>
    </div>
  );
}

/**
 * The person's page header: avatar, name, job title and company, then one quiet line with their email, phone,
 * where they are, their local time and their profile links. The record page draws it as its header.
 */
export const personSummaryBlock = defineBlockComponent({
  id: ids.blocks.person_summary,
  label: 'Person summary',
  icon: 'user',
  surfaces: { record: { objectIds: [ids.objects.person], frame: false, header: true } },
  component: PersonSummary,
});
