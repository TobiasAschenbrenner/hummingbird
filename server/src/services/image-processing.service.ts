import sharp from 'sharp';
import { HttpError } from '../errors/http-error.ts';

export async function processCoverImage(bytes: Buffer, mediaType: string): Promise<Buffer> {
  const formats: Record<string, string> = {
    'image/jpeg': 'jpeg',
    'image/png': 'png',
    'image/webp': 'webp',
  };
  if (!formats[mediaType]) throw new HttpError(415, 'Choose a JPEG, PNG or WebP image.');
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 5 * 1024 * 1024)
    throw new HttpError(400, 'Choose an image no larger than 5 MiB.');
  try {
    const input = sharp(bytes, { limitInputPixels: 20_000_000, failOn: 'warning', animated: true });
    const metadata = await input.metadata();
    if (metadata.format !== formats[mediaType] || (metadata.pages ?? 1) !== 1)
      throw new Error('Unsupported image.');
    return await input
      .rotate()
      .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 85 })
      .toBuffer();
  } catch {
    throw new HttpError(
      400,
      'The image is damaged, animated, too large in dimensions or does not match its file type.',
    );
  }
}
