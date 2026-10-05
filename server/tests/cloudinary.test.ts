import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Writable } from 'node:stream';
import type { UploadApiOptions } from 'cloudinary';

import { readCloudinaryConfig } from '../src/config/cloudinary.ts';
import { HttpError } from '../src/errors/http-error.ts';
import {
  createCloudinaryStorage,
  type CloudinaryTransport,
} from '../src/services/cloudinary.service.ts';

const config = readCloudinaryConfig({
  CLOUDINARY_CLOUD_NAME: 'hummingbird-test-cloud',
  CLOUDINARY_API_KEY: '123456789012345',
  CLOUDINARY_API_SECRET: 'fake-secret-only',
  NODE_ENV: 'test',
})!;
const id = `${config.assetFolder}/e54247c6-fc30-4d4b-b0b1-27c7a0f029a5`;
function response(publicId = id) {
  return {
    public_id: publicId,
    secure_url: `https://res.cloudinary.com/${config.cloudName}/image/upload/v123/${publicId}.webp`,
    width: 1200,
    height: 800,
    format: 'webp',
    resource_type: 'image',
    type: 'upload',
    secret: 'private-response-field',
  };
}
function fakeRemote(result: unknown = response()) {
  const uploads: { options: UploadApiOptions; bytes: Buffer[] }[] = [];
  const removals: { publicId: string; options: UploadApiOptions }[] = [];
  const remote: CloudinaryTransport = {
    uploadStream(options, callback) {
      const bytes: Buffer[] = [];
      uploads.push({ options, bytes });
      return new Writable({
        write(chunk, _encoding, done) {
          bytes.push(Buffer.from(chunk));
          done();
        },
        final(done) {
          callback(undefined, result);
          done();
        },
      });
    },
    async remove(publicId, options) {
      removals.push({ publicId, options });
      return { result: 'ok' };
    },
  };
  return { remote, uploads, removals };
}
function safeFailure(error: unknown): boolean {
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 502);
  assert.equal(error.message, 'Image storage is unavailable. Please try again later.');
  assert.equal(error.cause, undefined);
  return true;
}

test('Cloudinary generates distinct IDs only in the configured Hummingbird namespace', () => {
  const storage = createCloudinaryStorage(config, fakeRemote().remote);
  const first = storage.newPublicId();
  const second = storage.newPublicId();
  assert.notEqual(first, second);
  assert.match(first, /^hummingbird\/test\/article-covers\/[0-9a-f-]{36}$/);
  assert.throws(
    () => createCloudinaryStorage({ ...config, assetFolder: 'chirp' }),
    /Hummingbird article-cover namespace/,
  );
});

test('Cloudinary streams only the supplied bytes and returns whitelisted image metadata', async () => {
  const { remote, uploads } = fakeRemote();
  const storage = createCloudinaryStorage(config, remote);
  const buffer = Buffer.from('already processed image; decoder is implemented in a later step');
  assert.deepEqual(await storage.upload(id, buffer), {
    publicId: id,
    url: response().secure_url,
    width: 1200,
    height: 800,
  });
  assert.deepEqual(Buffer.concat(uploads[0]!.bytes), buffer);
  assert.equal(uploads.length, 1);
  const options = uploads[0]!.options;
  assert.equal(options.cloud_name, config.cloudName);
  assert.equal(options.api_key, config.apiKey);
  assert.equal(options.api_secret, config.apiSecret);
  assert.equal(options.public_id, id);
  assert.equal(options.asset_folder, config.assetFolder);
  assert.equal(options.overwrite, false);
  assert.equal(options.use_filename, false);
  assert.equal(options.resource_type, 'image');
  assert.equal(options.type, 'upload');
  assert.deepEqual(options.allowed_formats, ['webp']);
  assert.equal(options.timeout, 30_000);
  assert.equal(options.upload_preset, undefined);
});

test('Cloudinary uses each client’s own credentials instead of changing global SDK configuration', async () => {
  const { remote, uploads } = fakeRemote();
  await createCloudinaryStorage(config, remote).upload(id, Buffer.from('image'));
  await createCloudinaryStorage(
    { ...config, apiKey: '9876543210', apiSecret: 'another-fake-secret' },
    remote,
  ).upload(id, Buffer.from('image'));
  await createCloudinaryStorage(config, remote).upload(id, Buffer.from('image'));
  assert.deepEqual(
    uploads.map(({ options }) => options.api_key),
    [config.apiKey, '9876543210', config.apiKey],
  );
});

test('Cloudinary refuses empty or oversized buffers and IDs from another application or environment before storage access', async () => {
  const { remote, uploads, removals } = fakeRemote();
  const storage = createCloudinaryStorage(config, remote);
  for (const publicId of [
    'chirp/photo',
    id.replace('/test/', '/production/'),
    id + '.webp',
    id.replace('article-covers/', 'article-covers/../'),
    config.assetFolder + '/filename',
  ]) {
    await assert.rejects(storage.upload(publicId, Buffer.from('image')), /Refusing an image ID/);
    await assert.rejects(storage.remove(publicId), /Refusing an image ID/);
  }
  for (const buffer of [Buffer.alloc(0), Buffer.alloc(5 * 1024 * 1024 + 1)]) {
    await assert.rejects(
      storage.upload(id, buffer),
      (error: unknown) => error instanceof HttpError && error.status === 400,
    );
  }
  assert.equal(uploads.length, 0);
  assert.equal(removals.length, 0);
});

test('Cloudinary rejects unexpected response identity, type, dimensions and unsafe delivery URLs', async () => {
  for (const result of [
    null,
    {},
    { ...response(), public_id: 'chirp/photo' },
    { ...response(), resource_type: 'raw' },
    { ...response(), type: 'private' },
    { ...response(), format: 'svg' },
    { ...response(), width: 0 },
    { ...response(), height: 1601 },
    { ...response(), width: '1200' },
    { ...response(), secure_url: response().secure_url.replace('https:', 'http:') },
    {
      ...response(),
      secure_url: response().secure_url.replace('res.cloudinary.com', 'evil.example'),
    },
    { ...response(), secure_url: response().secure_url.replace(config.cloudName, 'chirp-cloud') },
    { ...response(), secure_url: response().secure_url + '?secret=private' },
    { ...response(), secure_url: response().secure_url + '#fragment' },
    { ...response(), secure_url: 'not a URL' },
  ])
    await assert.rejects(
      createCloudinaryStorage(config, fakeRemote(result).remote).upload(id, Buffer.from('image')),
      safeFailure,
    );
});

test('Cloudinary upload errors and stream failures hide SDK details without automatically retrying', async () => {
  for (const kind of ['throw', 'callback', 'stream']) {
    let calls = 0;
    const remote: CloudinaryTransport = {
      ...fakeRemote().remote,
      uploadStream(_options, callback) {
        calls++;
        const error = new Error('SDK private API secret and request details');
        if (kind === 'throw') throw error;
        return new Writable({
          write(_chunk, _encoding, done) {
            if (kind === 'callback') {
              callback(error);
              done();
            } else done(error);
          },
        });
      },
    };
    await assert.rejects(
      createCloudinaryStorage(config, remote).upload(id, Buffer.from('image')),
      safeFailure,
    );
    assert.equal(calls, 1);
  }
});

test('Cloudinary bounds stalled uploads and ignores a late success after timeout', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let callback: ((error?: unknown, result?: unknown) => void) | undefined;
  let calls = 0;
  const stream = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  const remote = {
    ...fakeRemote().remote,
    uploadStream(_options: UploadApiOptions, done: typeof callback) {
      calls++;
      callback = done;
      return stream;
    },
  };
  const promise = createCloudinaryStorage(config, remote).upload(id, Buffer.from('image'));
  const failed = assert.rejects(promise, safeFailure);
  context.mock.timers.tick(30_000);
  await failed;
  callback?.(undefined, response());
  assert.equal(calls, 1);
  assert.equal(stream.destroyed, true);
});

test('Cloudinary cleanup accepts an already-removed asset and invalidates only its exact public ID', async () => {
  for (const result of ['ok', 'not found']) {
    const { remote, removals } = fakeRemote();
    remote.remove = async (publicId, options) => {
      removals.push({ publicId, options });
      return { result };
    };
    await createCloudinaryStorage(config, remote).remove(id);
    assert.equal(removals.length, 1);
    assert.equal(removals[0]!.publicId, id);
    assert.equal(removals[0]!.options.invalidate, true);
    assert.equal(removals[0]!.options.resource_type, 'image');
    assert.equal(removals[0]!.options.api_secret, config.apiSecret);
  }
});

test('Cloudinary cleanup hides failures and unexpected responses', async () => {
  for (const value of [null, {}, { result: 'error' }]) {
    const remote = { ...fakeRemote().remote, remove: async () => value };
    await assert.rejects(createCloudinaryStorage(config, remote).remove(id), safeFailure);
  }
  const remote = {
    ...fakeRemote().remote,
    remove: async () => {
      throw new Error('private SDK secret');
    },
  };
  await assert.rejects(createCloudinaryStorage(config, remote).remove(id), safeFailure);
});

test('Cloudinary bounds stalled cleanup without automatically repeating it', async (context) => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let calls = 0;
  const remote = {
    ...fakeRemote().remote,
    remove: () => {
      calls++;
      return new Promise<unknown>(() => {});
    },
  };
  const failed = assert.rejects(createCloudinaryStorage(config, remote).remove(id), safeFailure);
  context.mock.timers.tick(30_000);
  await failed;
  assert.equal(calls, 1);
});
