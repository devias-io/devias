import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ui',
    include: ['test/**/*.test.tsx'],
    environment: 'jsdom',
  },
});
