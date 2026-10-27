import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'mod-invoicing',
    include: ['test/**/*.test.{ts,tsx}'],
    environment: 'jsdom',
  },
});
