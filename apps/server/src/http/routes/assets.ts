import {
  AssetSchema,
  AssetUploadQuerySchema,
  contentDispositionOf,
  FILE_VARIANT_FITS,
  FILE_VARIANT_WIDTHS,
  type FileVariantSpec,
  type FileVariantWidth,
  fileVariantKeyOf,
  isInlineSafe,
} from '@devias/core';
import type { DataEngine, OpenedFile } from '@devias/data-engine';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { AppEnv } from '../env';
import { HttpError } from '../errors';
import { errorResponses, jsonResponse, security, WorkspaceParam } from './schemas';

/** The bytes of a file in an OpenAPI response or request. */
const BinarySchema = z.string().meta({ format: 'binary' });
const bytesOf = (description: string) => ({
  content: { 'application/octet-stream': { schema: BinarySchema } },
  description,
});

const VariantQuery = z.object({
  w: z.coerce
    .number()
    .int()
    .refine((w) => (FILE_VARIANT_WIDTHS as readonly number[]).includes(w), {
      message: `w is one of ${FILE_VARIANT_WIDTHS.join(', ')}`,
    })
    .optional()
    .meta({
      description: `A smaller WebP of a picture, this many pixels wide (one of ${FILE_VARIANT_WIDTHS.join(', ')}). Made on the first request and kept; anything that cannot be resized (an animated or very large picture, an SVG, no image library on the server) is served as it is.`,
    }),
  fit: z.enum(FILE_VARIANT_FITS).optional().meta({
    description:
      'With `w`: `inside` (the default) fits the picture in a square of that side without enlarging it, `cover` fills the square and crops.',
  }),
});

/** The variant a request asks for, if it does. */
const variantOf = (query: {
  w?: number | undefined;
  fit?: 'inside' | 'cover' | undefined;
}): FileVariantSpec | undefined =>
  query.w === undefined ? undefined : { width: query.w as FileVariantWidth, fit: query.fit ?? 'inside' };

const ContentQuery = VariantQuery.extend({
  download: z
    .enum(['true', 'false'])
    .optional()
    .meta({ description: 'true offers the file as a download instead of showing it in the page' }),
});
const SignedQuery = ContentQuery.extend({
  exp: z
    .string()
    .optional()
    .meta({ description: 'When the link expires, in Unix seconds. Not needed for a public file.' }),
  sig: z.string().optional().meta({ description: 'The signature of the link. Not needed for a public file.' }),
});

/** An `<img>` or a viewer reads this with the headers below; a PDF viewer is a document of its own, not a page. */
const POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
/** Chrome refuses to open a PDF whose response carries `sandbox`; the file is not HTML and `nosniff` keeps it so. */
const PDF_POLICY = "default-src 'none'; style-src 'unsafe-inline'";

interface ByteRangeRequest {
  start: number;
  end: number;
}

/**
 * The one range a `Range: bytes=…` header asks for, `null` when there is none worth honouring (no header, several
 * ranges: the whole file is a valid answer) and `'unsatisfiable'` when it lies outside the file.
 */
export const parseRange = (header: string | undefined, size: number): ByteRangeRequest | 'unsatisfiable' | null => {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');

  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }

  if (match[1] === '') {
    const last = Number(match[2]);

    return last === 0 || size === 0 ? 'unsatisfiable' : { start: Math.max(size - last, 0), end: size - 1 };
  }

  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);

  return start >= size || start > end ? 'unsatisfiable' : { start, end };
};

const matchesEtag = (header: string | undefined, etag: string): boolean =>
  header
    ?.split(',')
    .map((tag) => tag.trim().replace(/^W\//, ''))
    .some((tag) => tag === etag || tag === '*') === true;

interface ServeOptions {
  download: boolean;
  /** A smaller version of a picture, when asked for. */
  variant?: FileVariantSpec | undefined;
  /** Signed links never change what they open, so a browser may keep the file until the link expires. */
  cache: { kind: 'signed'; expiresAt: number } | { kind: 'public' };
  now: () => Date;
}

const cacheControlOf = (cache: ServeOptions['cache'], now: () => Date): string =>
  cache.kind === 'public'
    ? 'public, max-age=31536000, immutable'
    : `private, max-age=${Math.max(Math.floor(cache.expiresAt - now().getTime() / 1000), 0)}, immutable`;

/** Answers with the bytes of an opened file: headers that keep any file harmless, `ETag`, ranges and a 304. */
const serve = async (c: Context<AppEnv>, original: OpenedFile, options: ServeOptions): Promise<Response> => {
  let opened = original;

  if (options.variant) {
    const tag = `"${original.file.checksum}-${fileVariantKeyOf(options.variant)}"`;

    // A browser that holds this very variant need not wait for it to be found or made.
    if (matchesEtag(c.req.header('if-none-match'), tag)) {
      return c.body(null, 304, {
        ETag: tag,
        'Cache-Control': cacheControlOf(options.cache, options.now),
        'X-Content-Type-Options': 'nosniff',
      });
    }

    // No variant to make (no image library, a picture it cannot resize): the original is the answer.
    opened = (await original.variant?.(options.variant)) ?? original;
  }

  const { file } = opened;
  const inline = isInlineSafe(file.contentType) && !options.download;
  const etag = `"${file.checksum}"`;
  const headers: Record<string, string> = {
    'Content-Type': file.contentType,
    'Content-Disposition': contentDispositionOf(inline ? 'inline' : 'attachment', file.name),
    ETag: etag,
    'Accept-Ranges': 'bytes',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': file.contentType === 'application/pdf' ? PDF_POLICY : POLICY,
    'Cache-Control': cacheControlOf(options.cache, options.now),
  };

  if (matchesEtag(c.req.header('if-none-match'), etag)) {
    return c.body(null, 304, headers);
  }

  const range = parseRange(c.req.header('range'), file.size);

  if (range === 'unsatisfiable') {
    return c.body(null, 416, { ...headers, 'Content-Range': `bytes */${file.size}` });
  }

  if (range === null) {
    return c.body(await opened.read(), 200, { ...headers, 'Content-Length': String(file.size) });
  }

  return c.body(await opened.read(range), 206, {
    ...headers,
    'Content-Range': `bytes ${range.start}-${range.end}/${file.size}`,
    'Content-Length': String(range.end - range.start + 1),
  });
};

/**
 * The bytes of files. Not actions: an action carries JSON, and these carry a file. Uploading takes the raw body (never
 * a form: it would be buffered and is harder to cap) and counts it as it streams. Reading is one route for everyone,
 * `GET /files/{id}`: a private file is signed (the `url` of an asset) and a public one is not, so `<img>`, PDF viewers
 * and api keys all read the same way and permission is checked when the link is made.
 */
export const registerAssetRoutes = (
  app: OpenAPIHono<AppEnv>,
  deps: { engine: DataEngine; maxBytes: number; now?: () => Date },
) => {
  const { engine, maxBytes } = deps;
  const now = deps.now ?? (() => new Date());

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/workspaces/{workspaceId}/assets',
      summary: 'Upload a file',
      description:
        'The body is the file itself (not a form), its name goes in `name`. The type is detected from the bytes, never taken from the request. Refused with `VALIDATION`, storing nothing, when it is over the limit (`FILE_MAX_BYTES`, 25 MB by default) or the workspace is out of storage. Not an action: an upload is bytes, so agents create files with `create_asset_from_text`.',
      tags: ['assets'],
      security,
      request: {
        params: WorkspaceParam,
        query: AssetUploadQuerySchema,
        body: { ...bytesOf('The file'), required: true },
      },
      responses: {
        201: jsonResponse(AssetSchema, 'Stored'),
        400: errorResponses[400],
        401: errorResponses[401],
        403: errorResponses[403],
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const declared = Number(c.req.header('content-length'));

      // Say no before reading a body that is too big for sure; the stream is counted too, for one that does not say.
      if (Number.isFinite(declared) && declared > maxBytes) {
        throw new HttpError('VALIDATION', `A file may be at most ${Math.round(maxBytes / 1024 / 1024)} MB`, {
          maxBytes,
        });
      }

      const body = c.req.raw.body;

      if (!body) {
        throw new HttpError('VALIDATION', 'The body must be the file');
      }

      const asset = await engine.assets.create(c.get('ctx'), {
        name: query.name,
        ...(query.description === undefined ? {} : { description: query.description }),
        body,
      });

      return c.json(asset, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/files/{id}',
      summary: 'Download a file',
      description:
        'The bytes of a file, with no credentials: every client, a browser `<img>` or an api key, reads a file the same way. A public file (an account picture, a workspace logo) needs nothing but its link, which never changes. A private file needs a signed link the server made (the `url` every asset carries, or a link a person asked for) and opens until it expires. Pictures and PDFs are shown in place and everything else is offered as a download, whatever the name; `download=true` always offers a download. `ETag` is the file’s SHA-256 and `Range` is honoured. `404` once the file is deleted; `403` for a private file without a valid link: one that has expired, was changed or has no signature.',
      tags: ['assets'],
      security: [],
      request: { params: z.object({ id: z.string() }), query: SignedQuery },
      responses: {
        200: bytesOf('The file'),
        206: bytesOf('The part of the file asked for'),
        304: { description: 'Unchanged since the ETag the request sent' },
        403: errorResponses[403],
        404: errorResponses[404],
        416: { description: 'The range lies outside the file' },
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const query = c.req.valid('query');
      const { exp, sig, download } = query;
      const opened = await engine.files.openByLink(id, exp, sig);

      return serve(c, opened, {
        download: download === 'true',
        variant: variantOf(query),
        // Bytes never change, so a public file's link is kept for good; a signed one while it lasts.
        cache: opened.file.public ? { kind: 'public' } : { kind: 'signed', expiresAt: Number(exp) },
        now,
      });
    },
  );
};
