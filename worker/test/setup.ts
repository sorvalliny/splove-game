import { beforeAll } from 'vitest';
import { env, applyD1Migrations } from 'cloudflare:test';

beforeAll(async () => {
  await applyD1Migrations(env.DB, (env as { TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1] }).TEST_MIGRATIONS);
});
