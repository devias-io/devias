import { createHmac, timingSafeEqual } from 'node:crypto';
import { ASSET_LINK_DEFAULT_TTL_SECONDS, ASSET_LINK_MAX_TTL_SECONDS, type AssetLink } from '@devias/core';

/** What a link names: the file, the workspace it belongs to (none for what belongs to a person), and whether it is public. */
export interface SignedFile {
  id: string;
  workspaceId: string | null;
  /** A public file needs no signature: its link is the same for ever. */
  public?: boolean;
}

/**
 * Makes and checks the links that open a file without credentials (`<img>`, a PDF viewer, a link in an email). A link is
 * `/files/<id>?exp=<unix seconds>&sig=<signature>`; the signature covers the workspace, the file and the
 * expiry, so none can be swapped.
 */
export interface FileUrlSigner {
  /**
   * The link embedded content uses: for a public file, its plain permanent link; for a private one, a signed link that is
   * the same for everyone all day, so browsers keep the file.
   */
  url(file: SignedFile): string;
  /** A signed link a person asked for, valid for `ttlSeconds` (default 10 minutes, at most 7 days), public file or not. */
  link(file: SignedFile, ttlSeconds?: number): AssetLink;
  /** Whether `exp` and `sig` are right for the file and `exp` has not passed. */
  verify(file: SignedFile, exp: string, sig: string): boolean;
}

export interface FileUrlSignerOptions {
  /** The server's secret; the signing key is derived from it, apart from every other use of it. */
  secret: string;
  /** Where the API is, when links must be absolute; relative paths otherwise. */
  baseUrl?: string;
  /** Embedded links change once per bucket; each outlives its bucket by another one. Default one day. */
  bucketSeconds?: number;
  maxLinkSeconds?: number;
  clock?: () => Date;
}

export const DEFAULT_FILE_URL_BUCKET_SECONDS = 24 * 60 * 60;

/** The secret used when none is configured: fine for tests, never for a server people can reach. */
export const DEV_FILE_URL_SECRET = 'devias-dev-file-url-secret-not-for-production';

export const createFileUrlSigner = (options: FileUrlSignerOptions): FileUrlSigner => {
  const clock = options.clock ?? (() => new Date());
  const bucket = options.bucketSeconds ?? DEFAULT_FILE_URL_BUCKET_SECONDS;
  const maxLink = options.maxLinkSeconds ?? ASSET_LINK_MAX_TTL_SECONDS;
  const base = (options.baseUrl ?? '').replace(/\/+$/, '');
  const key = createHmac('sha256', options.secret).update('devias:file-url:v1').digest();

  const signature = (file: SignedFile, exp: number): Buffer =>
    createHmac('sha256', key)
      .update(`${file.workspaceId ?? ''}\n${file.id}\n${exp}`)
      .digest();

  const urlOf = (file: SignedFile, exp: number): string =>
    `${base}/files/${file.id}?exp=${exp}&sig=${signature(file, exp).toString('base64url')}`;

  const nowSeconds = (): number => Math.floor(clock().getTime() / 1000);
  const plainUrlOf = (file: SignedFile): string => `${base}/files/${file.id}`;

  return {
    url: (file) => (file.public ? plainUrlOf(file) : urlOf(file, (Math.floor(nowSeconds() / bucket) + 2) * bucket)),

    link: (file, ttlSeconds = ASSET_LINK_DEFAULT_TTL_SECONDS) => {
      const exp = nowSeconds() + Math.min(Math.max(ttlSeconds, 1), maxLink);

      return { url: urlOf(file, exp), expiresAt: new Date(exp * 1000).toISOString() };
    },

    verify: (file, exp, sig) => {
      const expiry = Number(exp);

      if (!Number.isInteger(expiry) || expiry <= nowSeconds()) {
        return false;
      }

      const given = Buffer.from(sig, 'base64url');
      const expected = signature(file, expiry);

      return given.length === expected.length && timingSafeEqual(given, expected);
    },
  };
};
