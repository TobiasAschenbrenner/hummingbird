import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { v2 as cloudinary, type UploadApiOptions } from 'cloudinary';

import type { CloudinaryConfig } from '../config/cloudinary.ts';
import { HttpError } from '../errors/http-error.ts';
import type { ImageStorage, StoredImage } from '../models/image.model.ts';

const TIMEOUT_MS = 30_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export interface CloudinaryTransport {
  uploadStream(
    options: UploadApiOptions,
    callback: (error?: unknown, result?: unknown) => void,
  ): Writable;
  remove(publicId: string, options: UploadApiOptions): Promise<unknown>;
}

const transport: CloudinaryTransport = {
  uploadStream: (options, callback) => cloudinary.uploader.upload_stream(options, callback),
  remove: (publicId, options) => cloudinary.uploader.destroy(publicId, options),
};

function unavailable(): HttpError {
  return new HttpError(502, 'Image storage is unavailable. Please try again later.');
}

function storedImage(value: unknown, publicId: string, cloudName: string): StoredImage {
  if (!value || typeof value !== 'object') throw unavailable();
  const data = value as Record<string, unknown>;
  if (
    data['public_id'] !== publicId ||
    data['resource_type'] !== 'image' ||
    data['type'] !== 'upload' ||
    data['format'] !== 'webp' ||
    !Number.isSafeInteger(data['width']) ||
    !Number.isSafeInteger(data['height']) ||
    (data['width'] as number) < 1 ||
    (data['width'] as number) > 1600 ||
    (data['height'] as number) < 1 ||
    (data['height'] as number) > 1600 ||
    typeof data['secure_url'] !== 'string' ||
    data['secure_url'].length > 2048
  )
    throw unavailable();
  const url = new URL(data['secure_url']);
  if (
    url.origin !== 'https://res.cloudinary.com' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !url.pathname.startsWith(`/${cloudName}/image/upload/`) ||
    !url.pathname.endsWith(`/${publicId}.webp`)
  )
    throw unavailable();
  return {
    publicId,
    url: url.href,
    width: data['width'] as number,
    height: data['height'] as number,
  };
}

export function createCloudinaryStorage(
  config: CloudinaryConfig,
  remote: CloudinaryTransport = transport,
): ImageStorage {
  const { cloudName, apiKey, apiSecret, assetFolder } = config;
  if (!/^hummingbird\/(development|test|production)\/article-covers$/.test(assetFolder))
    throw new Error('Use a Hummingbird article-cover namespace.');
  const credentials: UploadApiOptions = {
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret,
    secure: true,
    timeout: TIMEOUT_MS,
  };
  function requireOwnedId(publicId: string): void {
    const suffix = publicId.startsWith(`${assetFolder}/`)
      ? publicId.slice(assetFolder.length + 1)
      : '';
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(suffix)) {
      throw new Error('Refusing an image ID outside the configured Hummingbird namespace.');
    }
  }
  return {
    newPublicId: () => `${assetFolder}/${randomUUID()}`,
    async upload(publicId, processedImage) {
      requireOwnedId(publicId);
      if (
        !Buffer.isBuffer(processedImage) ||
        processedImage.length === 0 ||
        processedImage.length > MAX_IMAGE_BYTES
      )
        throw new HttpError(400, 'Supply a processed image no larger than 5 MiB.');
      return new Promise<StoredImage>((resolve, reject) => {
        let stream: Writable | undefined;
        let settled = false;
        const deadline = setTimeout(() => {
          finish(unavailable());
          stream?.destroy();
        }, TIMEOUT_MS);
        function finish(error?: unknown, result?: unknown): void {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          if (error) {
            reject(unavailable());
            return;
          }
          try {
            resolve(storedImage(result, publicId, cloudName));
          } catch {
            reject(unavailable());
          }
        }
        try {
          stream = remote.uploadStream(
            {
              ...credentials,
              public_id: publicId,
              asset_folder: assetFolder,
              resource_type: 'image',
              type: 'upload',
              allowed_formats: ['webp'],
              overwrite: false,
              use_filename: false,
            },
            finish,
          );
          stream.once('error', finish);
          if (!settled) stream.end(processedImage);
        } catch {
          finish(unavailable());
        }
      });
    },
    async remove(publicId) {
      requireOwnedId(publicId);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          remote.remove(publicId, {
            ...credentials,
            resource_type: 'image',
            type: 'upload',
            invalidate: true,
          }),
          new Promise<never>((_resolve, reject) => {
            deadline = setTimeout(() => reject(unavailable()), TIMEOUT_MS);
          }),
        ]);
        if (
          !result ||
          typeof result !== 'object' ||
          !('result' in result) ||
          typeof result.result !== 'string' ||
          !['ok', 'not found'].includes(result.result)
        )
          throw unavailable();
      } catch {
        throw unavailable();
      } finally {
        if (deadline) clearTimeout(deadline);
      }
    },
  };
}
