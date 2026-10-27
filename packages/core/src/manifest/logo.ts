/** What a module's logo may be: a small image kept in its own package (see "The manifest" in the module docs). */
export const MODULE_LOGO_MAX_BYTES = 256 * 1024;

/** The file types a logo may have, by extension, and what the server calls each. */
export const MODULE_LOGO_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  webp: 'image/webp',
};

/**
 * Why `path` cannot name a logo, or null when it can. The path is relative to the module's package and stays inside
 * it: no address, no drive, no `..`. The file itself (that it exists, its size) is checked where the package is.
 */
export const moduleLogoProblem = (path: string): string | null => {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
    return 'A logo is a file in the package, not an address';
  }

  if (path.startsWith('/') || path.includes('\\')) {
    return 'A logo is a relative path inside the package (./logo.svg)';
  }

  if (path.split('/').includes('..')) {
    return 'A logo stays inside the package: no ".." in its path';
  }

  const extension = path.split('.').pop()?.toLowerCase() ?? '';

  if (!(extension in MODULE_LOGO_TYPES)) {
    return `A logo is ${Object.keys(MODULE_LOGO_TYPES)
      .map((one) => `.${one}`)
      .join(', ')}`;
  }

  return null;
};

/** The content type a logo is served with, from its path. */
export const moduleLogoType = (path: string): string | undefined =>
  MODULE_LOGO_TYPES[path.split('.').pop()?.toLowerCase() ?? ''];
