import { readConfig } from './environment.ts';

export interface CloudinaryConfig {
  cloudName: string;
  apiKey: string;
  apiSecret: string;
  assetFolder: string;
}

export function readCloudinaryConfig(
  environment: NodeJS.ProcessEnv = process.env,
): CloudinaryConfig | null {
  const cloudName = environment.CLOUDINARY_CLOUD_NAME ?? '';
  const apiKey = environment.CLOUDINARY_API_KEY ?? '';
  const apiSecret = environment.CLOUDINARY_API_SECRET ?? '';
  if (!cloudName && !apiKey && !apiSecret) return null;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error(
      'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET together, or leave all three blank.',
    );
  }
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(cloudName)) {
    throw new Error('CLOUDINARY_CLOUD_NAME must be a plain Cloudinary cloud name.');
  }
  if (!/^[0-9]{1,64}$/.test(apiKey)) {
    throw new Error('CLOUDINARY_API_KEY must be a numeric Cloudinary API key.');
  }
  if (apiSecret.length > 256 || !/^[\x21-\x7E]+$/.test(apiSecret)) {
    throw new Error(
      'CLOUDINARY_API_SECRET must be a nonblank secret without whitespace or control characters.',
    );
  }
  const { nodeEnv } = readConfig(environment);
  return { cloudName, apiKey, apiSecret, assetFolder: `hummingbird/${nodeEnv}/article-covers` };
}
