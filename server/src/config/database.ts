export function readDatabaseUrl(
  variable = 'DATABASE_URL',
  environment: NodeJS.ProcessEnv = process.env,
): string {
  const value = environment[variable];
  const message = `${variable} must be a PostgreSQL URL with a host, username and database name.`;

  if (!value) {
    throw new Error(message);
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }

  if (
    !['postgresql:', 'postgres:'].includes(url.protocol) ||
    !url.hostname ||
    !url.username ||
    !/^\/[^/]+$/.test(url.pathname) ||
    url.hash
  ) {
    throw new Error(message);
  }

  return value;
}

export function readMigrationDatasource(environment: NodeJS.ProcessEnv = process.env) {
  const url = environment.DATABASE_URL ? readDatabaseUrl('DATABASE_URL', environment) : '';
  const shadowDatabaseUrl = environment.SHADOW_DATABASE_URL
    ? readDatabaseUrl('SHADOW_DATABASE_URL', environment)
    : undefined;

  if (url && shadowDatabaseUrl && isSameDatabase(new URL(url), new URL(shadowDatabaseUrl))) {
    throw new Error('SHADOW_DATABASE_URL must not point to DATABASE_URL.');
  }

  return { url, shadowDatabaseUrl };
}

export function isSameDatabase(first: URL, second: URL): boolean {
  return databaseIdentity(first) === databaseIdentity(second);
}

function databaseIdentity(url: URL): string {
  const hostname = url.hostname.toLowerCase();
  const host = ['localhost', '127.0.0.1', '[::1]'].includes(hostname) ? 'loopback' : hostname;

  return `${host}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`;
}
