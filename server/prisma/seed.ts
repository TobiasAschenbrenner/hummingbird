import { createDatabaseClient } from '../src/database/client.ts';
import { seedDatabase } from './seed-database.ts';
import { readSeedOptions } from './seed-options.ts';

async function main() {
  const options = readSeedOptions();
  const database = createDatabaseClient();
  try {
    const added = await seedDatabase(database, options);
    console.log(
      `Seed complete. Added: ${Object.entries(added)
        .map(([table, count]) => `${count} ${table}`)
        .join(', ')}.`,
    );
  } finally {
    await database.$disconnect();
  }
}

main().catch(() => {
  console.error(
    'Seeding failed. Check the database connection, migrations, demo restrictions and conflicting demo accounts.',
  );
  process.exitCode = 1;
});
