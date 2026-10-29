import type { FileVariantSpec } from '@devias/core';
import type { ImageInfo, ImageProcessor, Logger } from '@devias/data-engine';

/** The most pixels a picture may have to be decoded: a bigger one is served as it is, never resized. */
export const MAX_IMAGE_PIXELS = 50_000_000;

/** The slice of the sharp API this uses; sharp is optional, so it is loaded when needed and not imported at the top. */
type Sharp = typeof import('sharp')['default'];

/**
 * The image library over `sharp` (libvips, prebuilt for Linux, macOS and Windows). Optional: when it cannot be loaded
 * (an unsupported platform, a failed install) the server logs it once and serves every picture as it was uploaded.
 * Nothing here is allowed to take a request down: whatever cannot be read or made is null.
 */
export const createSharpProcessor = async (
  logger: Logger,
  options: { maxPixels?: number } = {},
): Promise<ImageProcessor | undefined> => {
  let sharp: Sharp;

  try {
    sharp = (await import('sharp')).default;
  } catch (error) {
    logger.warn(
      'the image library (sharp) could not be loaded; pictures are served as uploaded, without thumbnails',
      error,
    );

    return undefined;
  }

  const maxPixels = options.maxPixels ?? MAX_IMAGE_PIXELS;
  // One thread per conversion; the engine decides how many run at once.
  sharp.concurrency(1);

  const info = async (head: Uint8Array): Promise<ImageInfo | null> => {
    try {
      const meta = await sharp(head, { limitInputPixels: false, failOn: 'none' }).metadata();

      if (!meta.width || !meta.height) {
        return null;
      }

      // Orientations 5 to 8 turn the picture a quarter: it is shown the other way round.
      const turned = (meta.orientation ?? 1) >= 5;

      return {
        width: turned ? meta.height : meta.width,
        height: turned ? meta.width : meta.height,
        animated: (meta.pages ?? 1) > 1,
      };
    } catch {
      return null;
    }
  };

  const variant = async (bytes: Uint8Array, spec: FileVariantSpec): Promise<Uint8Array | null> => {
    try {
      const image = sharp(bytes, { limitInputPixels: maxPixels, failOn: 'error' });
      const meta = await image.metadata();

      if (!meta.width || !meta.height || meta.width * meta.height > maxPixels || (meta.pages ?? 1) > 1) {
        return null;
      }

      // `rotate()` applies the orientation and drops it; no metadata is kept in the output.
      const sized = image
        .rotate()
        .resize(
          spec.fit === 'cover'
            ? { width: spec.width, height: spec.width, fit: 'cover' }
            : { width: spec.width, height: spec.width, fit: 'inside', withoutEnlargement: true },
        );

      return new Uint8Array(await sized.webp({ quality: 80 }).toBuffer());
    } catch {
      return null;
    }
  };

  return { info, variant };
};
