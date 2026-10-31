import type { CoverQueries, CoverTarget, ImageStorage } from '../models/image.model.ts';
import { processCoverImage } from './image-processing.service.ts';

export function createCoverService(queries: CoverQueries, images: ImageStorage) {
  return {
    checkTarget: (target: CoverTarget) => queries.checkTarget(target),
    async upload(target: CoverTarget, bytes: Buffer, mediaType: string) {
      const processed = await processCoverImage(bytes, mediaType);
      const publicId = images.newPublicId();
      // Reserve before the external call so a timeout or process crash remains recoverable.
      await queries.reserve(publicId);
      const image = await images.upload(publicId, processed);
      return queries.attach(target, image);
    },
    remove: (target: CoverTarget) => queries.detach(target),
  };
}
export type CoverService = ReturnType<typeof createCoverService>;

export async function cleanupCoverImages(
  queries: CoverQueries,
  images: ImageStorage,
  now = new Date(),
) {
  const before = new Date(now.getTime() - 3600_000);
  const candidates = await queries.listDetached(before);
  let removed = 0;
  let failed = 0;
  for (const publicId of candidates) {
    try {
      await images.remove(publicId);
      await queries.forgetDetached(publicId, before);
      removed++;
    } catch {
      failed++;
    }
  }
  return { removed, failed };
}
