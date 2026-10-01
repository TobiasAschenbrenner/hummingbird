import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readConfig } from '../src/config/environment.ts';
import { readDatabaseUrl, readMigrationDatasource } from '../src/config/database.ts';
import { readTestDatabaseUrl } from './helpers/database.ts';
import { readSeedOptions } from '../prisma/seed-options.ts';

test('uses local development defaults without requiring Flask settings', () => {
  assert.deepEqual(readConfig({}), { port: 3000, nodeEnv: 'development' });
});

test('accepts configured ports and supported environments', () => {
  for (const nodeEnv of ['development', 'test', 'production']) {
    for (const port of ['1', '3001', '65535']) {
      assert.deepEqual(readConfig({ PORT: port, NODE_ENV: nodeEnv }), {
        port: Number(port),
        nodeEnv,
      });
    }
  }
});

test('rejects malformed and out-of-range ports', () => {
  for (const port of ['', ' ', '0', '-1', '65536', '3000.5', '3e3', '3000oops', '0xBB8']) {
    assert.throws(() => readConfig({ PORT: port }), /PORT must be a whole number/);
  }
});

test('rejects unknown environments', () => {
  for (const nodeEnv of ['', 'staging', 'Production']) {
    assert.throws(() => readConfig({ NODE_ENV: nodeEnv }), /NODE_ENV must be/);
  }
});

test('accepts PostgreSQL connection URLs without echoing credentials', () => {
  for (const protocol of ['postgres', 'postgresql']) {
    const url = `${protocol}://user:encoded%40password@localhost:5432/hummingbird_rewrite`;
    assert.equal(readDatabaseUrl('DATABASE_URL', { DATABASE_URL: url }), url);
  }
});

test('rejects missing or malformed database configuration', () => {
  for (const value of [
    undefined,
    '',
    'invalid',
    'https://user:secret@localhost/db',
    'postgresql://localhost/db',
    'postgresql://user@localhost',
    'postgresql://user@localhost/first/second',
    'postgresql://user:secret@localhost/db#fragment',
  ]) {
    assert.throws(() => readDatabaseUrl('DATABASE_URL', { DATABASE_URL: value }), {
      message: 'DATABASE_URL must be a PostgreSQL URL with a host, username and database name.',
    });
  }
});

test('database tests accept only a separate disposable database', () => {
  const testUrl = 'postgresql://user:secret@localhost/hummingbird_rewrite_test';
  assert.equal(
    readTestDatabaseUrl({
      TEST_DATABASE_URL: testUrl,
      DATABASE_URL: 'postgresql://user@localhost/hummingbird_rewrite',
    }),
    testUrl,
  );

  for (const url of [
    'postgresql://user@localhost/hummingbird',
    `${testUrl}?schema=public`,
    `${testUrl}?schema=production`,
  ]) {
    assert.throws(() => readTestDatabaseUrl({ TEST_DATABASE_URL: url }), /disposable database/);
  }

  assert.throws(() => readTestDatabaseUrl({}), /TEST_DATABASE_URL must be/);
});

test('database test guard recognizes the same database through local aliases', () => {
  for (const hostname of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]']) {
    assert.throws(
      () =>
        readTestDatabaseUrl({
          TEST_DATABASE_URL: 'postgresql://test_user@localhost/rewrite_test',
          DATABASE_URL: `postgresql://dev_user@${hostname}:5432/rewrite_test`,
        }),
      /must not point to DATABASE_URL/,
    );
  }
});

test('client generation needs no database URL, but shadow migrations require isolation', () => {
  assert.deepEqual(readMigrationDatasource({}), { url: '', shadowDatabaseUrl: undefined });
  const url = 'postgresql://user@localhost/hummingbird_rewrite';
  const shadowUrl = 'postgresql://user@localhost/hummingbird_rewrite_shadow';
  assert.deepEqual(readMigrationDatasource({ DATABASE_URL: url, SHADOW_DATABASE_URL: shadowUrl }), {
    url,
    shadowDatabaseUrl: shadowUrl,
  });
  for (const hostname of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]']) {
    assert.throws(
      () =>
        readMigrationDatasource({
          DATABASE_URL: url,
          SHADOW_DATABASE_URL: `postgresql://other_user@${hostname}:5432/hummingbird_rewrite?schema=other`,
        }),
      /SHADOW_DATABASE_URL must not point to DATABASE_URL/,
    );
  }
});

test('seeding defaults to categories and rejects unrecognized arguments', () => {
  assert.deepEqual(readSeedOptions([], { NODE_ENV: 'production' }), { demo: false });
  for (const args of [['--unknown'], ['demo'], ['--demo=false']]) {
    assert.throws(() => readSeedOptions(args));
  }
});

test('demo seed guard permits only local rewrite development or test databases', () => {
  for (const host of ['localhost', 'LOCALHOST', '127.0.0.1', '[::1]']) {
    for (const name of ['hummingbird_rewrite', 'hummingbird_rewrite_test']) {
      assert.deepEqual(
        readSeedOptions(['--demo'], {
          DATABASE_URL: `postgresql://user@${host}:5432/${name}`,
          NODE_ENV: 'test',
        }),
        { demo: true },
      );
    }
  }
  const url = 'postgresql://user:secret@localhost/hummingbird_rewrite';
  assert.deepEqual(readSeedOptions(['--demo'], { DATABASE_URL: url }), { demo: true });
  assert.deepEqual(readSeedOptions(['--demo'], { DATABASE_URL: `${url}?schema=public` }), {
    demo: true,
  });
  for (const environment of [
    { DATABASE_URL: url, NODE_ENV: 'production' },
    { DATABASE_URL: url, NODE_ENV: 'staging' },
    { DATABASE_URL: 'postgresql://user@remote.example/hummingbird_rewrite' },
    { DATABASE_URL: 'postgresql://user@localhost/hummingbird' },
    { DATABASE_URL: 'postgresql://user@localhost/hummingbird_rewrite_shadow' },
    { DATABASE_URL: `${url}?schema=other` },
    { DATABASE_URL: `${url}?schema=public&schema=other` },
    { DATABASE_URL: `${url}?host=remote.example` },
    { DATABASE_URL: `${url}?port=5433` },
    { DATABASE_URL: `${url}?options=-c%20search_path=other` },
  ]) {
    assert.throws(() => readSeedOptions(['--demo'], environment), /limited to local rewrite/);
  }
  assert.throws(() => readSeedOptions(['--demo'], {}), /DATABASE_URL must be/);
});
