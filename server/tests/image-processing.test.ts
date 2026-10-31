import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { processCoverImage } from '../src/services/image-processing.service.ts';
import { cleanupCoverImages, createCoverService } from '../src/services/cover.service.ts';
import type { CoverQueries, ImageStorage } from '../src/models/image.model.ts';

test('cover decoding converts allowed formats, resizes without enlargement and removes source metadata', async () => {
  for (const [format, mediaType] of [
    ['jpeg', 'image/jpeg'],
    ['png', 'image/png'],
    ['webp', 'image/webp'],
  ] as const) {
    const source = await sharp({
      create: { width: 2000, height: 1000, channels: 3, background: 'red' },
    })
      .withMetadata()
      .toFormat(format)
      .toBuffer();
    const processed = await processCoverImage(source, mediaType);
    const metadata = await sharp(processed).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 800);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
  }
  const small = await sharp({ create: { width: 40, height: 20, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  assert.equal((await sharp(await processCoverImage(small, 'image/png')).metadata()).width, 40);
  await assert.rejects(processCoverImage(small, 'image/jpeg'));
  await assert.rejects(processCoverImage(Buffer.from('bad data'), 'image/png'));
  await assert.rejects(processCoverImage(Buffer.from('<svg/>'), 'image/svg+xml'));
  const large = await sharp({
    create: { width: 5000, height: 5000, channels: 3, background: 'red' },
  })
    .png()
    .toBuffer();
  await assert.rejects(processCoverImage(large, 'image/png'));
});

test('failed external uploads retain the prior durable reservation, and cleanup retries failures', async () => {
  const calls: string[] = [];
  const queries = {
    async reserve() {
      calls.push('reserve');
    },
    async attach() {
      calls.push('attach');
    },
    async listDetached() {
      return ['first', 'second'];
    },
    async forgetDetached(publicId: string) {
      calls.push('forget:' + publicId);
    },
  } as unknown as CoverQueries;
  const images = {
    newPublicId: () => 'reserved',
    async upload() {
      calls.push('upload');
      throw new Error('remote failed');
    },
    async remove(publicId: string) {
      if (publicId === 'first') throw new Error('retry later');
    },
  } as ImageStorage;
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  await assert.rejects(
    createCoverService(queries, images).upload(
      { slug: 'article', articleId: 1, authorId: 1, version: '1' },
      png,
      'image/png',
    ),
  );
  assert.deepEqual(calls, ['reserve', 'upload']);
  assert.deepEqual(await cleanupCoverImages(queries, images), { removed: 1, failed: 1 });
  assert.deepEqual(calls, ['reserve', 'upload', 'forget:second']);
});
