import { readCloudinaryConfig } from '../config/cloudinary.ts';
import { createDatabaseClient } from '../database/client.ts';
import { createCoverQueries } from '../queries/cover.queries.ts';
import { createCloudinaryStorage } from '../services/cloudinary.service.ts';
import { cleanupCoverImages } from '../services/cover.service.ts';

const config = readCloudinaryConfig();
if (!config) throw new Error('Configure Cloudinary before running image cleanup.');
const database = createDatabaseClient();
try {
  const result = await cleanupCoverImages(
    createCoverQueries(database),
    createCloudinaryStorage(config),
  );
  console.log(
    `Image cleanup: ${result.removed} removed, ${result.failed} failed (retained for retry).`,
  );
  if (result.failed) process.exitCode = 1;
} catch {
  console.error('Image cleanup failed; records are retained for retry.');
  process.exitCode = 1;
} finally {
  await database.$disconnect();
}
