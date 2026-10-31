import { isSameDatabase, readDatabaseUrl } from '../../src/config/database.ts';

export function readTestDatabaseUrl(environment: NodeJS.ProcessEnv = process.env): string {
  const connectionString = readDatabaseUrl('TEST_DATABASE_URL', environment);
  const target = new URL(connectionString);
  const databaseName = decodeURIComponent(target.pathname.slice(1));

  if (!databaseName.endsWith('_test') || target.searchParams.has('schema')) {
    throw new Error(
      'TEST_DATABASE_URL must use a disposable database ending in _test without schema overrides.',
    );
  }

  if (environment.DATABASE_URL) {
    const development = new URL(readDatabaseUrl('DATABASE_URL', environment));
    if (isSameDatabase(target, development)) {
      throw new Error('TEST_DATABASE_URL must not point to DATABASE_URL.');
    }
  }

  return connectionString;
}
