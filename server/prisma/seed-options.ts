import { parseArgs } from 'node:util';

import { readDatabaseUrl } from '../src/config/database.ts';

export function readSeedOptions(
  args: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
) {
  const { values } = parseArgs({
    args,
    options: { demo: { type: 'boolean', default: false } },
    allowPositionals: false,
  });

  if (values.demo) {
    const url = new URL(readDatabaseUrl('DATABASE_URL', environment));
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    if (
      !['development', 'test'].includes(environment.NODE_ENV ?? 'development') ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) ||
      !['hummingbird_rewrite', 'hummingbird_rewrite_test'].includes(databaseName) ||
      [...url.searchParams].some(([name, value]) => name !== 'schema' || value !== 'public')
    ) {
      throw new Error('Demo seeding is limited to local rewrite development and test databases.');
    }
  }

  return { demo: values.demo };
}
