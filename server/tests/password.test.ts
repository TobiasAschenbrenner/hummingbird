import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verify } from 'argon2';

import { hashPassword } from '../src/services/password.service.ts';

test('password hashing uses Argon2id, unique salts and preserves Unicode and whitespace', async () => {
  const password = '  my lengthy 🔑 password  ';
  const first = await hashPassword(password);
  const second = await hashPassword(password);
  assert.match(first, /^\$argon2id\$v=19\$/);
  const parameters = Object.fromEntries(
    first
      .split('$')[3]!
      .split(',')
      .map((part) => part.split('=')),
  );
  assert.deepEqual(parameters, { m: '19456', t: '2', p: '1' });
  assert.notEqual(first, second);
  assert.equal(await verify(first, password), true);
  assert.equal(await verify(second, password), true);
  assert.equal(await verify(first, password.trim()), false);
  assert.equal(await verify(first, 'a different password'), false);
});
