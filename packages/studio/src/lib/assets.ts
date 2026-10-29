import {
  type Asset,
  assetGroupOf,
  type FileVariantFit,
  type FileVariantWidth,
  fileVariantUrl,
  isRasterImage,
} from '@devias/core';
import type { IconName } from '@devias/ui';

/** "12 B", "3.4 KB", "1.2 MB": a size as people read it. */
export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value >= 100 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
};

/** The icon and the word for what kind of file a type is. */
export const assetKindOf = (contentType: string): { icon: IconName; label: string } => {
  switch (assetGroupOf(contentType)) {
    case 'image':
      return { icon: 'image', label: 'Image' };
    case 'pdf':
      return { icon: 'file-text', label: 'PDF' };
    case 'text':
      return { icon: 'file-text', label: 'Text' };
    default:
      return { icon: 'file', label: 'File' };
  }
};

/** The extension of a file name, in capitals and short enough for a tile: "PNG", "XLSX", nothing when there is none. */
export const extensionOf = (name: string): string => {
  const dot = name.lastIndexOf('.');

  return dot > 0 && name.length - dot <= 6 ? name.slice(dot + 1).toUpperCase() : '';
};

/**
 * A small picture of an asset to draw in a tile: a thumbnail the server makes of the pictures it can resize, the picture
 * itself for an SVG (an `<img>` runs nothing), nothing for the rest. A link that is not the server's (the mock's data and
 * object URLs) is returned as it is.
 */
export const thumbnailOf = (
  asset: Pick<Asset, 'url' | 'contentType'>,
  width: FileVariantWidth,
  fit: FileVariantFit = 'cover',
): string | null => {
  if (asset.contentType === 'image/svg+xml') {
    return asset.url;
  }

  if (!isRasterImage(asset.contentType)) {
    return null;
  }

  return /^(https?:\/\/|\/)/.test(asset.url) ? fileVariantUrl(asset.url, { w: width, fit }) : asset.url;
};

/** The link that offers an asset as a download. */
export const downloadUrlOf = (asset: Pick<Asset, 'url'>): string =>
  `${asset.url}${asset.url.includes('?') ? '&' : '?'}download=true`;

/** Starts a download of a link: a link opened with `download` saves the file, whatever it is. */
export const startDownload = (url: string, name: string) => {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
};
