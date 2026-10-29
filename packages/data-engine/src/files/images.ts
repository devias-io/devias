import type { FileVariantSpec } from '@devias/core';

/** What can be read of a picture without decoding it. */
export interface ImageInfo {
  /** As the picture is shown: turned the way its orientation says. */
  width: number;
  height: number;
  /** More than one frame (an animated GIF): it gets no variants. */
  animated: boolean;
}

/**
 * The image library: optional, and kept behind this interface so the engine needs no native code. Without one every
 * picture is served as it was uploaded and its size is not known; when it fails on a picture it says so by returning null
 * and the picture is served as it is.
 */
export interface ImageProcessor {
  /** The size of a picture, from its first bytes (enough to read the header); null when it cannot be read. */
  info(head: Uint8Array): Promise<ImageInfo | null>;
  /**
   * A variant of a whole picture as WebP bytes (turned the way its orientation says, without its metadata), or null when
   * there is none to make: an animated picture, one too large to decode safely, one that cannot be read.
   */
  variant(bytes: Uint8Array, spec: FileVariantSpec): Promise<Uint8Array | null>;
}
