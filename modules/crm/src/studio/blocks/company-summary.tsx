import { defineBlockComponent, type RecordData } from '@devias/core';
import { externalHref, shortAddress } from '@devias/studio';
import { Icon, type IconName } from '@devias/ui';
import { INDUSTRIES, ids } from '../../manifest';
import { CompanyLogo, META, META_LINK } from '../shared';

const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);

/** The company's profiles and site, in the order they show. */
const LINKS: { field: string; label: string; icon: IconName }[] = [
  { field: 'linkedin', label: 'LinkedIn', icon: 'linkedin' },
  { field: 'domain', label: 'Website', icon: 'globe' },
];

function CompanySummary({ record }: { record?: RecordData }) {
  if (!record) {
    return <div className="text-xs text-muted-foreground">No record.</div>;
  }

  const name = text(record.name) ?? record.id;
  const industry = INDUSTRIES.find((option) => option.value === record.industry)?.label;
  const website = text(record.domain);
  const city = text(record.city);
  const email = text(record.email);
  const phone = text(record.phone);
  const links = LINKS.flatMap((link) => {
    const value = text(record[link.field]);

    return value ? [{ ...link, href: externalHref(value.trim()) }] : [];
  });

  return (
    <div data-slot="company-summary">
      <div className="flex items-center gap-3.5">
        <CompanyLogo logo={text(record.logo)} className="size-11" />
        <div className="min-w-0">
          <h1 className="truncate font-heading text-heading">{name}</h1>
          {industry || website ? (
            <div className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {industry ? <span>{industry}</span> : null}
              {industry && website ? <span aria-hidden>·</span> : null}
              {website ? <span>{shortAddress(website)}</span> : null}
            </div>
          ) : null}
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1">
        {city ? (
          <span className={META}>
            <Icon name="map-pin" /> {city}
          </span>
        ) : null}
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
        {links.length > 0 ? (
          <span className="contents" data-slot="company-links">
            {links.map((link) => (
              <a
                key={link.field}
                href={link.href}
                target="_blank"
                rel="noreferrer noopener"
                aria-label={link.label}
                className={META_LINK}
              >
                <Icon name={link.icon} /> {link.label}
              </a>
            ))}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** The company's page header: logo, name, industry and website, then one quiet line with where it is and its contact and profile links. The record page draws it as its header. */
export const companySummaryBlock = defineBlockComponent({
  id: ids.blocks.company_summary,
  label: 'Company summary',
  icon: 'building-2',
  surfaces: { record: { objectIds: [ids.objects.company], frame: false, header: true } },
  component: CompanySummary,
});
