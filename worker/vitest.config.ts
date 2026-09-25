import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';

const migrations = await readD1Migrations(path.join(import.meta.dirname, 'migrations'));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.toml' },
      miniflare: {
        bindings: {
          BOT_TOKEN: '123456:TEST_TOKEN_FOR_TESTS_ONLY',
          CHAT_ID: '-5327135658',
          TEST_MIGRATIONS: migrations,
        },
      },
    }),
  ],
  test: { setupFiles: ['./test/setup.ts'] },
});
