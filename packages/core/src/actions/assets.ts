import { z } from 'zod';
import {
  AssetLinkInputSchema,
  AssetLinkSchema,
  AssetPageSchema,
  AssetPatchSchema,
  AssetQuerySchema,
  AssetSchema,
  AssetsUsageSchema,
  AssetUsageSchema,
} from '../asset';
import { coreIds } from '../core-ids';
import { defineActionSpec } from './define';

const tags = ['assets'];
const IdParams = z.object({ id: z.string() });
const DeleteQuery = z.object({
  /** Delete it even though records or text use it: they are left reading "file removed". */
  force: z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]).optional(),
});

/**
 * Assets: the files a workspace stores. Uploading and downloading the bytes are routes of their own (`POST …/assets`,
 * `GET /files/{id}`): an action carries JSON. What is about a file, not its bytes, is an action like any other.
 */
export const assetActions = {
  list: defineActionSpec({
    id: coreIds.actions.list_assets,
    ai: {
      tool: 'list_assets',
      description:
        'List the files of the workspace, newest change first, with their names, types and sizes. `search` matches the name and the description; `type` is image, pdf, text or other; `ids` picks some by id. Refer to a file in your answer with a link, [Name](asset:<id>). Page with nextCursor.',
    },
    summary: 'List files',
    description:
      'Newest change first; page with `nextCursor`. `search` matches the name and the description, `type` keeps one kind of file (`image`, `pdf`, `text`, `other`), `createdBy` keeps what one person uploaded, `ids` picks some by id. Every file carries a `url` that opens it without credentials until it expires.',
    tags,
    permission: 'asset.read',
    query: AssetQuerySchema,
    output: AssetPageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/assets',
      errors: [400, 401, 403, 409],
      outputDescription: 'A page of files',
    },
  }),
  get: defineActionSpec({
    id: coreIds.actions.get_asset,
    ai: {
      tool: 'get_asset',
      description:
        'Read the details of one file: name, description, type, size, who uploaded it and when. It does not return the content.',
    },
    summary: 'Get a file',
    description: 'The file’s details, not its bytes: those are at the `url` it carries (`GET /files/{id}`).',
    tags,
    permission: 'asset.read',
    params: IdParams,
    output: AssetSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/assets/{id}',
      errors: [401, 403, 404],
      outputDescription: 'The file',
    },
  }),
  update: defineActionSpec({
    id: coreIds.actions.update_asset,
    ai: {
      tool: 'update_asset',
      description:
        'Rename a file or change its description. The content of a file never changes. Pass the version you read as expectedVersion so a change made meanwhile is not lost.',
    },
    summary: 'Update a file',
    description:
      'Sends only what changes: the `name` and the `description`. The bytes of a file never change. With `expectedVersion`, a file that changed since is a `CONFLICT`; without it the change overwrites.',
    tags,
    permission: 'asset.write',
    params: IdParams,
    body: AssetPatchSchema,
    output: AssetSchema,
    http: { method: 'patch', path: '/api/workspaces/{workspaceId}/assets/{id}', outputDescription: 'Updated' },
  }),
  delete: defineActionSpec({
    id: coreIds.actions.delete_asset,
    ai: {
      tool: 'delete_asset',
      description:
        'Delete a file for good: its content is removed. A file that records or text still use is refused, with where it is used; delete it anyway only when the person says so.',
    },
    summary: 'Delete a file',
    description:
      'Removes the content for good. A file that is in use is refused with `CONFLICT` and where it is used; `force=true` deletes it anyway and the places that used it read "file removed".',
    tags,
    permission: 'asset.write',
    params: IdParams,
    query: DeleteQuery,
    http: {
      method: 'delete',
      path: '/api/workspaces/{workspaceId}/assets/{id}',
      errors: [401, 403, 404, 409],
      outputDescription: 'Deleted',
    },
  }),
  link: defineActionSpec({
    id: coreIds.actions.create_asset_link,
    ai: {
      tool: 'create_asset_link',
      description:
        'Make a link that opens a file without signing in, for 10 minutes unless ttlSeconds says otherwise (at most 7 days). Anyone holding the link can read the file until it expires: make one only when the person asked to share the file outside the workspace.',
    },
    summary: 'Share a file with a link',
    description:
      'A link that opens the file without credentials until it expires: `ttlSeconds` (default 10 minutes, at most 7 days). Anyone who holds it can read the file.',
    tags,
    permission: 'asset.read',
    // A link is a capability whoever holds it can use; an injected instruction could use one to take a file out.
    approval: 'approve',
    locked: true,
    params: IdParams,
    body: AssetLinkInputSchema,
    output: AssetLinkSchema,
    http: {
      method: 'post',
      path: '/api/workspaces/{workspaceId}/assets/{id}/link',
      status: 201,
      errors: [400, 401, 403, 404],
      outputDescription: 'The link',
    },
  }),
  usage: defineActionSpec({
    id: coreIds.actions.get_asset_usage,
    ai: {
      tool: 'get_asset_usage',
      description: 'Where a file is used: the records that hold it and the text that links to it.',
    },
    summary: 'Where a file is used',
    description:
      'The records that hold the file in a `file` field and the documents, tasks and comments that link to it.',
    tags,
    permission: 'asset.read',
    params: IdParams,
    output: AssetUsageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/assets/{id}/usage',
      errors: [401, 403, 404],
      outputDescription: 'Where the file is used',
    },
  }),
  workspaceUsage: defineActionSpec({
    id: coreIds.actions.get_assets_usage,
    ai: {
      tool: 'get_assets_usage',
      description: 'How many files the workspace stores, how many bytes they take and its limit, if any.',
    },
    summary: 'How much storage the files take',
    description:
      'The number of files, the bytes they take and the most the workspace may store (`null` while unlimited).',
    tags,
    permission: 'asset.read',
    output: AssetsUsageSchema,
    http: {
      method: 'get',
      path: '/api/workspaces/{workspaceId}/asset-usage',
      errors: [401, 403],
      outputDescription: 'What the files take',
    },
  }),
};
