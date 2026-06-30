import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'remotion/src/**/*.test.ts'],
    testTimeout: 120_000, // integration tests spawn ffmpeg
  },
});
