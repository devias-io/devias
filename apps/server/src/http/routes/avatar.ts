import { AVATAR_MAX_BYTES, AVATAR_SIDE, assetNameOf, fileVariantUrl, isRasterImage } from '@devias/core';
import type { DataEngine } from '@devias/data-engine';
import { createRoute, type OpenAPIHono, z } from '@hono/zod-openapi';
import type { Auth } from '../../auth/auth';
import type { AppEnv } from '../env';
import { HttpError } from '../errors';
import { errorResponses, jsonResponse } from './schemas';

/** Only a person has a picture: the session, not an api key. */
const SESSION_ONLY: Record<string, string[]>[] = [{ cookieAuth: [] }];

/** The file an account picture's link names, when it is one of ours: `<anything>/files/<uuid>…`. */
const fileIdOfImage = (image: string | null | undefined): string | null =>
  image?.match(/\/files\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[?#]|$)/i)?.[1] ?? null;

const AvatarSchema = z
  .object({ image: z.string().meta({ description: 'The link of the new picture' }) })
  .meta({ id: 'Avatar' });

/**
 * A person's picture. It is a public file (kind `avatar`, no workspace, so it shows in every workspace and on pages with no
 * session), and `user.image` holds its permanent link, a 256 px square of it. Setting one replaces the last; removing one
 * takes the file with it. Not actions: an upload is bytes, and an agent never changes a person's picture.
 */
export const registerAvatarRoutes = (
  app: OpenAPIHono<AppEnv>,
  deps: { auth: Auth; engine: DataEngine; baseUrl: string },
) => {
  const { auth, engine } = deps;
  const base = deps.baseUrl.replace(/\/+$/, '');

  const personOf = (principal: AppEnv['Variables']['principal']) => {
    if (principal.kind !== 'user') {
      throw new HttpError('FORBIDDEN', 'Only a person has a picture');
    }

    return principal;
  };

  /** Takes a person's old picture away once the new state is saved. Quiet: a file left behind is the sweeper's. */
  const dropFile = async (userId: string, image: string | null | undefined) => {
    const id = fileIdOfImage(image);
    const prefix = id ? await engine.files.removePersonal(userId, id, new Date()) : null;

    if (prefix) {
      await engine.files.discard(prefix, `the picture of ${userId}`);
    }
  };

  app.openapi(
    createRoute({
      method: 'post',
      path: '/api/me/avatar',
      summary: 'Set your picture',
      description: `The body is the picture itself (a PNG, JPEG, WebP, GIF or AVIF of at most ${AVATAR_MAX_BYTES / 1024 / 1024} MB), its name goes in \`name\`. It replaces the one you had. The answer is the link \`user.image\` now holds.`,
      tags: ['account'],
      security: SESSION_ONLY,
      request: {
        query: z.object({ name: z.string().trim().min(1).max(1000) }),
        body: {
          content: { 'application/octet-stream': { schema: z.string().meta({ format: 'binary' }) } },
          description: 'The picture',
          required: true,
        },
      },
      responses: {
        200: jsonResponse(AvatarSchema, 'Set'),
        400: errorResponses[400],
        401: errorResponses[401],
        403: errorResponses[403],
      },
    }),
    async (c) => {
      const principal = personOf(c.get('principal'));
      const declared = Number(c.req.header('content-length'));

      if (Number.isFinite(declared) && declared > AVATAR_MAX_BYTES) {
        throw new HttpError('VALIDATION', `A picture may be at most ${AVATAR_MAX_BYTES / 1024 / 1024} MB`);
      }

      const body = c.req.raw.body;

      if (!body) {
        throw new HttpError('VALIDATION', 'The body must be the picture');
      }

      const actor = { kind: 'user', id: principal.userId } as const;
      const written = await engine.files.write(
        { workspaceId: null, actor },
        { name: assetNameOf(c.req.valid('query').name), body, maxBytes: AVATAR_MAX_BYTES },
      );

      if (!isRasterImage(written.contentType)) {
        await engine.files.discard(written.prefix, 'a picture that was not one');
        throw new HttpError('VALIDATION', 'Use a PNG, JPEG, WebP, GIF or AVIF picture');
      }

      const now = new Date();
      await engine.db.transaction(async (tx) => engine.files.add(tx, written, { kind: 'avatar' }, actor, now));
      const image = fileVariantUrl(`${base}/files/${written.id}`, { w: AVATAR_SIDE, fit: 'cover' });

      try {
        await auth.api.updateUser({ headers: c.req.raw.headers, body: { image } });
      } catch (error) {
        // Not saved on the account: nothing may keep the new file.
        await dropFile(principal.userId, image);
        throw error;
      }

      await dropFile(principal.userId, principal.user.image);

      return c.json({ image }, 200);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete',
      path: '/api/me/avatar',
      summary: 'Remove your picture',
      description:
        'You have none afterwards, and the file is deleted. A picture that came from somewhere else (a sign-in with Google) is only forgotten.',
      tags: ['account'],
      security: SESSION_ONLY,
      responses: { 204: { description: 'Removed' }, 401: errorResponses[401], 403: errorResponses[403] },
    }),
    async (c) => {
      const principal = personOf(c.get('principal'));

      await auth.api.updateUser({ headers: c.req.raw.headers, body: { image: null } });
      await dropFile(principal.userId, principal.user.image);

      return c.body(null, 204);
    },
  );
};
