import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

import { readMigrationDatasource } from './src/config/database.ts';

config({ path: new URL('.env', import.meta.url), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --env-file-if-exists=.env prisma/seed.ts',
  },
  datasource: readMigrationDatasource(),
});
