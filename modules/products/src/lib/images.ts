/** How many pictures a product can have. */
export const MAX_IMAGES = 8;

/** The pictures a record stores: a list of links, in order (the first is the cover), without blanks or repeats. */
export const imagesOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((item): item is string => typeof item === 'string').map((item) => item.trim()))].filter(
        Boolean,
      )
    : [];

/** The list with `url` added at the end, unless it is blank, already there, or the list is full. */
export const withImage = (images: string[], url: string): string[] => {
  const next = url.trim();

  return next === '' || images.includes(next) || images.length >= MAX_IMAGES ? images : [...images, next];
};

/** The list without the picture at `index`. */
export const withoutImage = (images: string[], index: number): string[] => images.filter((_, i) => i !== index);

/** The list with the picture at `index` moved to the front, which makes it the cover. */
export const withCover = (images: string[], index: number): string[] => {
  const picked = images[index];

  return picked === undefined ? images : [picked, ...withoutImage(images, index)];
};
