/** What Context.dev says about a person (the fields this module reads) and how it fits a CRM person. */

export interface ContextPerson {
  location?: { city?: string | null; country?: string | null } | null;
  social_urls?: string[] | null;
  website_urls?: string[] | null;
  current_role?: {
    title?: string | null;
    organization?: { name?: string | null; domain?: string | null } | null;
    is_current?: boolean | null;
  } | null;
  current_role_status?: 'present' | 'none' | 'unknown' | null;
}

export interface EnrichResponse {
  match?: { status?: string; score?: number | null; person?: ContextPerson | null } | null;
}

const present = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';

/** Is there nothing in this CRM field yet? Only an empty field is filled in. */
export const isEmpty = (value: unknown): boolean => value === null || value === undefined || value === '';

const hostOf = (url: string): string | undefined => {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
};

/** The first profile URL on one of these sites, and (when given) with this path start. */
const profileOn = (urls: string[], hosts: string[], pathStart?: string): string | undefined =>
  urls.find((url) => {
    const host = hostOf(url);

    return (
      host !== undefined &&
      hosts.some((one) => host === one || host.endsWith(`.${one}`)) &&
      (pathStart === undefined || new URL(url).pathname.startsWith(pathStart))
    );
  });

/** The job Context.dev says the person holds now; a role that ended is not a title to write down. */
export const currentTitleOf = (person: ContextPerson): string | undefined => {
  const role = person.current_role;

  return present(role?.title) && (person.current_role_status === 'present' || role?.is_current === true)
    ? role.title.trim()
    : undefined;
};

/** The domain of the person's employer, if Context.dev gives one. */
export const employerDomainOf = (person: ContextPerson): string | undefined => {
  const domain = person.current_role?.organization?.domain;

  return present(domain) ? domain.trim().toLowerCase() : undefined;
};

/**
 * The values Context.dev gives a CRM person that the CRM person does not have yet, by field name. Nothing already
 * there is changed.
 */
export const fillableFields = (found: ContextPerson, current: Record<string, unknown>): Record<string, string> => {
  const social = found.social_urls ?? [];
  const candidates: Record<string, string | undefined> = {
    job_title: currentTitleOf(found),
    city: present(found.location?.city) ? found.location.city.trim() : undefined,
    country: present(found.location?.country) ? found.location.country.trim() : undefined,
    linkedin: profileOn(social, ['linkedin.com'], '/in/'),
    twitter: profileOn(social, ['x.com', 'twitter.com']),
    github: profileOn(social, ['github.com']),
    website: (found.website_urls ?? []).find(present),
  };
  const fill: Record<string, string> = {};

  for (const [field, value] of Object.entries(candidates)) {
    if (value !== undefined && isEmpty(current[field])) {
      fill[field] = value;
    }
  }

  return fill;
};
