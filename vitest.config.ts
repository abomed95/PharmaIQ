import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const local = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // En CI, les échecs sont republiés en annotations GitHub : ils apparaissent
    // sur la ligne fautive, sans avoir à ouvrir les journaux du job.
    reporters: process.env.GITHUB_ACTIONS ? ['default', 'github-actions'] : ['default'],
  },
  resolve: {
    alias: {
      '@pharmaiq/core': local('./packages/core/src/index.ts'),
      '@pharmaiq/db': local('./packages/db/src/index.ts'),
      '@pharmaiq/ai': local('./packages/ai/src/index.ts'),
      '@pharmaiq/whatsapp': local('./packages/whatsapp/src/index.ts'),
    },
  },
});
