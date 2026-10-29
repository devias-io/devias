import { type Asset, type AssetPage, coreIds } from '@devias/core';
import { defineAdapter, type ToolAdapters } from './types';

/**
 * A file as the model reads it: never the `url`. A signed link is a capability anyone holding it can use, and what a
 * model reads can be carried into text it writes or a request an injected instruction makes; the model refers to a file
 * by its id, `[Name](asset:<id>)`, and the studio opens it for the person looking. (`create_asset_link` is the one way a
 * link reaches a model, and it asks first.)
 */
const withoutUrl = ({ url: _url, ...rest }: Asset) => ({ ...rest, link: `asset:${rest.id}` });

export const assetAdapters: ToolAdapters = {
  [coreIds.actions.list_assets]: defineAdapter({
    shape: (page: AssetPage) => ({ ...page, items: page.items.map(withoutUrl) }),
  }),
  [coreIds.actions.get_asset]: defineAdapter({ shape: withoutUrl }),
  [coreIds.actions.update_asset]: defineAdapter({ shape: withoutUrl }),
};
