export const MAX_COVER_BYTES = 5 * 1024 * 1024;
export const COVER_IMAGE_TYPES: readonly string[] = ['image/jpeg', 'image/png', 'image/webp'];

export function isSupportedCoverFile(file: File): boolean {
  return COVER_IMAGE_TYPES.includes(file.type) && file.size > 0 && file.size <= MAX_COVER_BYTES;
}
