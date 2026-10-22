/**
 * What a failed create or rename of a workspace says. Slugs are unique across the whole server, so "already exists"
 * does not mean the person has that workspace: it may belong to someone else's account.
 */
export const workspaceErrorMessage = (error: unknown, slug: string, fallback: string): string => {
  const message = error instanceof Error ? error.message : '';

  if (/exist|taken|already/i.test(message)) {
    return `The address “${slug}” is taken by another workspace, possibly on a different account. Choose another one.`;
  }

  return message || fallback;
};
