/** 1200 → "1.2k", 3_400_000 → "3.4M": token counts as short as a table cell wants. */
export const formatTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
