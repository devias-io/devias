import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'email-resend',
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
