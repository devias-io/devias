/** Href builders. Every in-app link goes through here so the URL scheme lives in one place. */

const seg = (value: string) => encodeURIComponent(value);

export const links = {
  home: () => '/',
  signIn: (redirect?: string) => (redirect ? `/sign-in?redirect=${encodeURIComponent(redirect)}` : '/sign-in'),
  signUp: () => '/sign-up',
  workspaces: () => '/workspaces',
  invite: (invitationId: string) => `/invite/${seg(invitationId)}`,
  devUi: () => '/dev/ui',
  workspace: (slug: string) => `/workspaces/${seg(slug)}`,
  /** A page by its path (`billing/new`); each segment is encoded. */
  page: (slug: string, path: string) =>
    `/workspaces/${seg(slug)}/${path
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .map(seg)
      .join('/')}`,
  objects: (slug: string) => `/workspaces/${seg(slug)}/records`,
  object: (slug: string, object: string, view?: string) =>
    `/workspaces/${seg(slug)}/records/${seg(object)}${view ? `?view=${encodeURIComponent(view)}` : ''}`,
  record: (slug: string, object: string, id: string, tab?: string) =>
    `/workspaces/${seg(slug)}/records/${seg(object)}/${seg(id)}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`,
  settings: (slug: string, section?: string, item?: string) =>
    `/workspaces/${seg(slug)}/settings${section ? `/${seg(section)}${item ? `/${seg(item)}` : ''}` : ''}`,
  agents: (slug: string) => `/workspaces/${seg(slug)}/agents`,
  /** An agent's page: by id, or a new one; `tab` picks what it shows. */
  agent: (slug: string, id?: string, tab?: string) =>
    `/workspaces/${seg(slug)}/agents/${id ? seg(id) : 'new'}${tab ? `?tab=${encodeURIComponent(tab)}` : ''}`,
  skills: (slug: string) => `/workspaces/${seg(slug)}/skills`,
  /** A skill's page: by id, or a new one. */
  skill: (slug: string, id?: string) => `/workspaces/${seg(slug)}/skills/${id ? seg(id) : 'new'}`,
  documents: (slug: string) => `/workspaces/${seg(slug)}/documents`,
  document: (slug: string, id: string) => `/workspaces/${seg(slug)}/documents/${seg(id)}`,
  tasks: (slug: string) => `/workspaces/${seg(slug)}/tasks`,
  task: (slug: string, id: string) => `/workspaces/${seg(slug)}/tasks/${seg(id)}`,
  workflows: (slug: string) => `/workspaces/${seg(slug)}/workflows`,
  /** The workflow editor: a workflow by id, or a new one, optionally starting from a kind of trigger. */
  workflowEditor: (slug: string, id?: string, trigger?: string) =>
    `/workspaces/${seg(slug)}/workflows/${id ? seg(id) : 'new'}${!id && trigger ? `?trigger=${encodeURIComponent(trigger)}` : ''}`,
};

/** Split an href into its pathname and a flat search object (TanStack Router navigates with both). */
export const splitHref = (href: string): { pathname: string; search: Record<string, string> } => {
  const [pathname = '', query = ''] = href.split('?');
  const search: Record<string, string> = {};

  for (const [key, value] of new URLSearchParams(query)) {
    search[key] = value;
  }

  return { pathname, search };
};

/** Is `href` the current location (or a parent of it)? Used for sidebar active states. */
export const isActiveHref = (href: string, pathname: string, search: Record<string, unknown>): boolean => {
  const target = splitHref(href);
  const viewMatches = !target.search.view || String(search.view ?? '') === target.search.view;

  if (target.pathname === pathname) {
    return viewMatches;
  }

  return pathname.startsWith(`${target.pathname}/`) && viewMatches;
};
