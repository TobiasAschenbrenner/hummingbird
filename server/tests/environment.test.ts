import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readConfig } from '../src/config/environment.ts';

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
