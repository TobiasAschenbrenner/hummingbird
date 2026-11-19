import { parseArgs } from 'node:util';

import { readDatabaseUrl } from '../src/config/database.ts';

export function readSeedOptions(
  args: string[] = process.argv.slice(2),
  environment: NodeJS.ProcessEnv = process.env,
) {
  const { values } = parseArgs({
    args,
    options: {
      demo: { type: 'boolean', default: false },
      'confirm-production-database': { type: 'string' },
    },
    allowPositionals: false,
  });
  const confirmation = values['confirm-production-database'];
  if (confirmation !== undefined && !values.demo) {
    throw new Error('Production database confirmation requires --demo.');
  }

  if (values.demo) {
    const url = new URL(readDatabaseUrl('DATABASE_URL', environment));
    const databaseName = decodeURIComponent(url.pathname.slice(1));
    const nodeEnv = environment.NODE_ENV ?? 'development';
    const localDemo =
      confirmation === undefined &&
      ['development', 'test'].includes(nodeEnv) &&
      ['hummingbird_rewrite', 'hummingbird_rewrite_test'].includes(databaseName);
    const confirmedProduction =
      nodeEnv === 'production' &&
      databaseName === 'hummingbird' &&
      confirmation === databaseName &&
      decodeURIComponent(url.username) === 'hummingbird' &&
      ['', '5432'].includes(url.port);

    if (
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase()) ||
      [...url.searchParams].some(([name, value]) => name !== 'schema' || value !== 'public') ||
      (!localDemo && !confirmedProduction)
    ) {
      throw new Error(
        'Demo seeding is limited to local rewrite development and test databases, or the explicitly confirmed Hostinger production database.',
      );
    }
  }

  return { demo: values.demo };
}
