import type { ImageProcessor } from '@devias/data-engine';
import { silentLogger } from '@devias/data-engine';
import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSharpProcessor } from '../src/images/sharp-processor';

/** A solid picture, in a format. */
const picture = async (
  format: 'png' | 'jpeg' | 'webp' | 'gif' | 'avif',
  width = 120,
  height = 60,
  options: { orientation?: number } = {},
): Promise<Uint8Array> => {
  let image = sharp({ create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } } });

  if (options.orientation) {
    image = image.withMetadata({ orientation: options.orientation });
  }

  return new Uint8Array(await image[format]().toBuffer());
};

const sizeOf = async (bytes: Uint8Array) => {
  const meta = await sharp(bytes).metadata();

  return { width: meta.width, height: meta.height, format: meta.format, exif: meta.exif };
};

/** Two frames: an animated GIF. */
const animated = async (): Promise<Uint8Array> => {
  const frame = (r: number) =>
    sharp({ create: { width: 20, height: 10, channels: 3, background: { r, g: 0, b: 0 } } })
      .png()
      .toBuffer();
  const frames = await Promise.all([frame(255), frame(0)]);

  return new Uint8Array(
    await sharp(frames, { join: { animated: true } })
      .gif()
      .toBuffer(),
  );
};

describe('sharp image processor', () => {
  let images: ImageProcessor;

  beforeAll(async () => {
    const made = await createSharpProcessor(silentLogger);

    if (!made) {
      throw new Error('sharp did not load');
    }

    images = made;
  });

  it('reads the size of every format from its first bytes', async () => {
    for (const format of ['png', 'jpeg', 'webp', 'gif', 'avif'] as const) {
      const bytes = await picture(format);

      expect(await images.info(bytes), format).toEqual({ width: 120, height: 60, animated: false });
      // A header is enough: the first kilobyte of a larger picture says the same.
      expect(await images.info(bytes.subarray(0, 1024)), `${format} head`).toEqual({
        width: 120,
        height: 60,
        animated: false,
      });
    }
  });

  it('reports the size a picture is shown at, turned the way its orientation says', async () => {
    expect(await images.info(await picture('jpeg', 100, 50, { orientation: 6 }))).toMatchObject({
      width: 50,
      height: 100,
    });
    expect(await images.info(await picture('jpeg', 100, 50, { orientation: 1 }))).toMatchObject({
      width: 100,
      height: 50,
    });
  });

  it('says what it cannot read and when a picture is animated', async () => {
    expect(await images.info(new TextEncoder().encode('not a picture'))).toBeNull();
    expect(await images.info(new Uint8Array())).toBeNull();
    expect(await images.info(await animated())).toMatchObject({ animated: true });
  });

  it('makes a WebP that fits inside the square and never enlarges', async () => {
    const wide = await picture('png', 400, 200);
    const fitted = await images.variant(wide, { width: 128, fit: 'inside' });
    const portrait = await images.variant(await picture('png', 200, 400), { width: 128, fit: 'inside' });
    const small = await images.variant(await picture('png', 50, 30), { width: 256, fit: 'inside' });

    expect(await sizeOf(fitted as Uint8Array)).toMatchObject({ format: 'webp', width: 128, height: 64 });
    expect(await sizeOf(portrait as Uint8Array)).toMatchObject({ width: 64, height: 128 });
    expect(await sizeOf(small as Uint8Array)).toMatchObject({ width: 50, height: 30 });
  });

  it('makes a square that fills the side with cover, even from a smaller picture', async () => {
    for (const source of [await picture('jpeg', 400, 200), await picture('png', 60, 90)]) {
      const covered = await images.variant(source, { width: 64, fit: 'cover' });

      expect(await sizeOf(covered as Uint8Array)).toMatchObject({ format: 'webp', width: 64, height: 64 });
    }
  });

  it('applies the orientation and keeps no metadata in a variant', async () => {
    const turned = await picture('jpeg', 100, 50, { orientation: 6 });
    const variant = await images.variant(turned, { width: 256, fit: 'inside' });

    // Shown 50 wide and 100 tall, so that is what the variant is, and the orientation is gone with the rest.
    expect(await sizeOf(variant as Uint8Array)).toMatchObject({ width: 50, height: 100, exif: undefined });
    expect((await sharp(variant as Uint8Array).metadata()).orientation).toBeUndefined();
  });

  it('makes no variant of an animated picture, of something it cannot read, or of a picture too large to decode', async () => {
    expect(await images.variant(await animated(), { width: 64, fit: 'inside' })).toBeNull();
    expect(await images.variant(new TextEncoder().encode('not a picture'), { width: 64, fit: 'inside' })).toBeNull();

    const tight = (await createSharpProcessor(silentLogger, { maxPixels: 5000 })) as ImageProcessor;
    expect(await tight.variant(await picture('png', 100, 100), { width: 64, fit: 'inside' })).toBeNull();
    expect(await tight.variant(await picture('png', 50, 50), { width: 64, fit: 'inside' })).not.toBeNull();
  });
});
