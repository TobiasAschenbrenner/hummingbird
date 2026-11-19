import { PrismaPg } from '@prisma/adapter-pg';

import { readDatabaseUrl } from '../config/database.ts';
import { PrismaClient } from '../generated/prisma/client.ts';

export function createDatabaseClient(connectionString = readDatabaseUrl()) {
  const adapter = new PrismaPg({
    connectionString,
    // The Prisma pg adapter expects timestamp values and parameters in UTC.
    options: '-c timezone=UTC',
    max: 10,
    connectionTimeoutMillis: 5000,
  });

  return new PrismaClient({ adapter });
}
