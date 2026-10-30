/**
 * A file: stored bytes that never change, with a name. A file is for one thing (its `kind`): an `asset` is an entry of a
 * workspace's library (see `asset.ts`: what people and agents manage, link to and list), a `logo` is a workspace's logo and
 * an `avatar` is a person's picture, which no library lists. The bytes live in a store (a folder or an S3 bucket) keyed by
 * id, and `detectFileType` decides the content type from the bytes, never from what the client claimed.
 */

/** The largest account picture. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
/** The side, in pixels, of the square an account picture is shown from. */
export const AVATAR_SIDE: FileVariantWidth = 256;

export const FILE_KINDS = ['asset', 'logo', 'avatar'] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** The largest file the server accepts unless `FILE_MAX_BYTES` says otherwise. */
export const FILE_MAX_BYTES_DEFAULT = 25 * 1024 * 1024;
/** The widths a variant of an image may have, in pixels: any other `w` is refused. */
export const FILE_VARIANT_WIDTHS = [64, 128, 256, 512, 1024, 2048] as const;
export type FileVariantWidth = (typeof FILE_VARIANT_WIDTHS)[number];
export const FILE_VARIANT_FITS = ['inside', 'cover'] as const;
export type FileVariantFit = (typeof FILE_VARIANT_FITS)[number];

/** A variant of a picture: its width (or, for `cover`, the side of the square) and how it fits. */
export interface FileVariantSpec {
  width: FileVariantWidth;
  /** `inside` fits the picture in a square of that side without enlarging it; `cover` fills the square, cropping. */
  fit: FileVariantFit;
}

/** How a variant is named in the store and in its `ETag`: `w256-cover`. */
export const fileVariantKeyOf = (spec: FileVariantSpec): string => `w${spec.width}-${spec.fit}`;

/** The link of a variant of a picture, from the link of the file (`url` of an asset): the signature covers the file, the allow-list covers the rest. */
export const fileVariantUrl = (url: string, variant: { w: FileVariantWidth; fit?: FileVariantFit }): string =>
  `${url}${url.includes('?') ? '&' : '?'}w=${variant.w}${variant.fit ? `&fit=${variant.fit}` : ''}`;

/** The types a browser may show in place: everything else is offered as a download. */
export const INLINE_SAFE_FILE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
  'application/pdf',
];

/** The pictures the image library can resize and read the size of. */
export const RASTER_IMAGE_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/avif',
];

export const isInlineSafe = (contentType: string): boolean => INLINE_SAFE_FILE_TYPES.includes(contentType);

export const isRasterImage = (contentType: string): boolean => RASTER_IMAGE_TYPES.includes(contentType);

/** Whether a stored type is text a person or an agent can read as it is. */
export const isTextFile = (contentType: string): boolean =>
  contentType.startsWith('text/') ||
  contentType === 'application/json' ||
  contentType === 'application/xml' ||
  contentType === 'image/svg+xml';

/** Files whose text can be shown as it is, by extension: the bytes must also be valid UTF-8. */
const TEXT_TYPES_BY_EXTENSION: Record<string, string> = {
  txt: 'text/plain',
  log: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  htm: 'text/html',
  svg: 'image/svg+xml',
  yaml: 'text/yaml',
  yml: 'text/yaml',
  css: 'text/css',
  ics: 'text/calendar',
  vcf: 'text/vcard',
};

/** The bytes it needs to tell the types apart. */
export const FILE_SNIFF_BYTES = 8192;

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCharCode(...bytes.subarray(start, end));

const isUtf8 = (bytes: Uint8Array): boolean => {
  const decoder = new TextDecoder('utf-8', { fatal: true });

  // The sample may end inside a character: drop up to three bytes of it before giving up.
  for (let cut = 0; cut <= 3 && cut <= bytes.length; cut++) {
    try {
      const text = decoder.decode(bytes.subarray(0, bytes.length - cut));

      return !text.includes('\u0000');
    } catch {
      // try a shorter sample
    }
  }

  return false;
};

/**
 * The content type of a file, from its first bytes (`FILE_SNIFF_BYTES` are enough) and its name: pictures and PDFs by
 * their magic bytes; text, SVG and HTML by extension when the bytes are valid UTF-8; anything else is
 * `application/octet-stream`. What a client said the file was is never consulted.
 */
export const detectFileType = (head: Uint8Array, name = ''): string => {
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }

  if (startsWith(head, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }

  if (startsWith(head, [0x47, 0x49, 0x46, 0x38]) && (head[4] === 0x37 || head[4] === 0x39) && head[5] === 0x61) {
    return 'image/gif';
  }

  if (ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') {
    return 'image/webp';
  }

  if (ascii(head, 4, 8) === 'ftyp' && ['avif', 'avis'].includes(ascii(head, 8, 12))) {
    return 'image/avif';
  }

  // The specification allows junk before the header; a PDF viewer looks in the first kilobyte.
  if (ascii(head, 0, 1024).includes('%PDF-')) {
    return 'application/pdf';
  }

  const dot = name.lastIndexOf('.');
  const type = dot < 0 ? undefined : TEXT_TYPES_BY_EXTENSION[name.slice(dot + 1).toLowerCase()];

  return type !== undefined && isUtf8(head) ? type : 'application/octet-stream';
};

/**
 * The `Content-Disposition` of a download or an inline view (RFC 6266): an ASCII fallback and the real name encoded
 * (RFC 5987), so no name can end the header early.
 */
export const contentDispositionOf = (disposition: 'inline' | 'attachment', name: string): string => {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\%;]/g, '_');
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

  return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};
