import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { after, before, beforeEach, test } from 'node:test';

import { createApp } from '../src/app.ts';
import { EmailAlreadyExistsError } from '../src/errors/email-already-exists.error.ts';
import type { RegistrationInput } from '../src/models/user.model.ts';

let server: Server;
let baseUrl: string;
let receivedInputs: RegistrationInput[] = [];
let registrationError: Error | undefined;

const validInput = {
  username: 'Author',
  email: 'author@example.test',
  password: 'a long test password',
};

before(async () => {
  server = createApp({
    registerUser: async (input) => {
      receivedInputs.push(input);
      if (registrationError) throw registrationError;
      return { id: 1, username: input.username, email: input.email };
    },
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  receivedInputs = [];
  registrationError = undefined;
});

after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('health endpoint returns an uncached JSON response without database access', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-powered-by'), null);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('unknown routes return a consistent JSON error', async () => {
  const response = await fetch(`${baseUrl}/api/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: { message: 'Route not found.' } });
});

test('health endpoint does not accept writes', async () => {
  const response = await fetch(`${baseUrl}/api/health`, { method: 'POST' });
  assert.equal(response.status, 404);
});

function register(body: unknown) {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('registration normalizes display name and email without changing the password or email aliases', async () => {
  const password = '  a lengthy 🔑 password  ';
  const response = await register({
    username: '  Author 🐦  ',
    email: '  First.Last+Blog@GMAIL.COM  ',
    password,
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), {
    user: { id: 1, username: 'Author 🐦', email: 'first.last+blog@gmail.com' },
  });
  assert.deepEqual(receivedInputs, [
    { username: 'Author 🐦', email: 'first.last+blog@gmail.com', password },
  ]);
});

test('registration validates all fields before calling the service', async () => {
  const response = await register({ username: ' ', email: 'invalid', password: 'short' });
  assert.equal(response.status, 400);
  const result = await response.json();
  assert.deepEqual(Object.keys(result.error.fields).sort(), ['email', 'password', 'username']);
  assert.equal(receivedInputs.length, 0);
  assert.ok(!JSON.stringify(result).includes('short'));
});

test('registration rejects invalid types, missing fields, extra fields and malformed Unicode', async () => {
  const invalidInputs = [
    {},
    null,
    [],
    'not an object',
    { ...validInput, username: 42 },
    { ...validInput, email: false },
    { ...validInput, password: [] },
    { ...validInput, passwordHash: 'do not trust client hashes' },
    { ...validInput, username: 'Name\u0000' },
    { ...validInput, username: '\ud800' },
    { ...validInput, email: 'äuthor@example.test' },
    { ...validInput, email: 'Kauthor@example.test' },
    { ...validInput, email: 'author@localhost' },
    { ...validInput, password: ' '.repeat(15) },
    { ...validInput, password: 'a'.repeat(14) + '\ud800' },
  ];
  for (const input of invalidInputs) {
    const response = await register(input);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.equal(receivedInputs.length, 0);
});

test('registration counts Unicode characters and enforces database and password length limits', async () => {
  for (const password of ['a'.repeat(15), '🔑'.repeat(128)]) {
    const response = await register({ ...validInput, username: '🐦'.repeat(80), password });
    assert.equal(response.status, 201);
    await response.arrayBuffer();
  }
  for (const input of [
    { ...validInput, username: '🐦'.repeat(81) },
    { ...validInput, password: 'a'.repeat(14) },
    { ...validInput, password: '🔑'.repeat(129) },
    { ...validInput, email: `author@${'a'.repeat(60)}.${'b'.repeat(50)}.test` },
  ]) {
    const response = await register(input);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.equal(receivedInputs.length, 2);
});

test('registration accepts an email at the database length boundary', async () => {
  const email = `a@${'a'.repeat(60)}.${'b'.repeat(52)}.test`;
  assert.equal(email.length, 120);
  const response = await register({ ...validInput, email });
  assert.equal(response.status, 201);
  await response.arrayBuffer();
});

test('malformed JSON and oversized bodies produce safe JSON errors without calling the service', async () => {
  for (const [body, status] of [
    ['{"password":"secret"', 400],
    [JSON.stringify({ ...validInput, username: 'x'.repeat(16_384) }), 413],
  ] as const) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(typeof result.error.message, 'string');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  assert.equal(receivedInputs.length, 0);
});

test('registration rejects non-JSON, unsupported character sets and compressed bodies', async () => {
  const headerCases: Record<string, string>[] = [
    { 'Content-Type': 'text/plain' },
    { 'Content-Type': 'application/json; charset=iso-8859-1' },
    { 'Content-Type': 'application/json; charset=utf-16le' },
    { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
  ];
  for (const headers of headerCases) {
    const response = await fetch(`${baseUrl}/api/auth/register`, {
      method: 'POST',
      headers,
      body: JSON.stringify(validInput),
    });
    assert.equal(response.status, 415);
    await response.arrayBuffer();
  }
  assert.equal(receivedInputs.length, 0);
});

test('duplicate emails return a conflict without revealing stored account details', async () => {
  registrationError = new EmailAlreadyExistsError();
  const response = await register(validInput);
  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: { message: 'An account with this email already exists.' },
  });
});

test('unexpected service failures do not expose passwords, SQL or connection credentials', async () => {
  registrationError = new Error('INSERT users password secret; postgresql://user:secret@localhost');
  const response = await register(validInput);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: { message: 'Unable to process the request. Try again later.' },
  });
});

test('registration limits attempts before invoking the service and leaves health available', async () => {
  let calls = 0;
  const limitedServer = createApp({
    registerUser: async ({ username, email }) => {
      calls++;
      return { id: calls, username, email };
    },
  }).listen(0, '127.0.0.1');
  try {
    await once(limitedServer, 'listening');
    const address = limitedServer.address();
    assert.ok(address && typeof address !== 'string');
    const url = `http://127.0.0.1:${address.port}`;
    for (let attempt = 0; attempt < 50; attempt++) {
      const response = await fetch(`${url}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validInput),
      });
      assert.equal(response.status, 201);
      await response.arrayBuffer();
    }
    const blocked = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(validInput),
    });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('cache-control'), 'no-store');
    assert.ok(blocked.headers.get('retry-after'));
    assert.deepEqual(await blocked.json(), {
      error: { message: 'Too many registration attempts. Try again later.' },
    });
    assert.equal(calls, 50);
    const health = await fetch(`${url}/api/health`);
    assert.equal(health.status, 200);
    await health.arrayBuffer();
  } finally {
    await new Promise<void>((resolve, reject) => {
      limitedServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
