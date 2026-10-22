/** Studio runtime configuration from Vite env. In dev the API is proxied under the same origin. */
export const env = {
  /** Base URL of the API. Empty string means same-origin (the dev proxy forwards /api). */
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? '',
  mock: import.meta.env.VITE_MOCK === '1' || import.meta.env.VITE_MOCK === 'true',
  dev: import.meta.env.DEV,
};
