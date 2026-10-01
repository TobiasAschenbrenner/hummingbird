import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';

import { createApp } from '../src/app.ts';
import { EmailAlreadyExistsError } from '../src/errors/email-already-exists.error.ts';
import type { RegistrationInput, PublicUser } from '../src/models/user.model.ts';
import type { AuthenticationService, LoginInput } from '../src/models/session.model.ts';
import { HttpError } from '../src/errors/http-error.ts';
import type { AuthOptions } from '../src/routes/auth.routes.ts';

let server: Server;
let baseUrl: string;
let receivedInputs: RegistrationInput[] = [];
let registrationError: Error | undefined;

const publicUser = {
  id: 7,
  username: 'Author',
  email: 'author@example.test',
  passwordHash: 'private-hash',
};
const sessionToken = 'a'.repeat(43);
let loginInputs: { input: LoginInput; previousToken?: string }[] = [];
let userTokens: (string | undefined)[] = [];
let logoutTokens: (string | undefined)[] = [];
let signedInUser: PublicUser | null = publicUser;
let authenticationError: Error | undefined;
const authentication: AuthenticationService = {
  async login(input, previousToken) {
    loginInputs.push({ input, previousToken });
    if (authenticationError) throw authenticationError;
    return { user: publicUser, token: sessionToken, expiresAt: new Date(Date.now() + 86_400_000) };
  },
  async getUser(token) {
    userTokens.push(token);
    if (authenticationError) throw authenticationError;
    return signedInUser;
  },
  async logout(token) {
    logoutTokens.push(token);
    if (authenticationError) throw authenticationError;
  },
};

const validInput = {
  username: 'Author',
  email: 'author@example.test',
  password: 'a long test password',
};

beforeEach(async () => {
  server = createApp({
    authentication,
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
  authenticationError = undefined;
  loginInputs = [];
  userTokens = [];
  logoutTokens = [];
  signedInUser = publicUser;
});

afterEach(async () => {
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
    authentication,
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

function login(
  body: unknown = { email: validInput.email, password: validInput.password },
  cookie?: string,
) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hummingbird-Request': '1',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

test('login normalizes email, preserves the password, sets a protected cookie and returns only public fields', async () => {
  const password = '  a lengthy 🔑 password  ';
  const response = await login(
    { email: '  Author@Example.Test  ', password },
    'other=value; hummingbird_session=old-session',
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    user: { id: 7, username: 'Author', email: validInput.email },
  });
  assert.deepEqual(loginInputs, [
    { input: { email: validInput.email, password }, previousToken: 'old-session' },
  ]);
  const cookie = response.headers.get('set-cookie')!;
  assert.match(cookie, new RegExp(`^hummingbird_session=${sessionToken};`));
  assert.match(cookie, /; HttpOnly/);
  assert.match(cookie, /; SameSite=Lax/);
  assert.match(cookie, /; Path=\//);
  assert.match(cookie, /; Expires=/);
  assert.doesNotMatch(cookie, /; Secure|; Domain=/);
});

test('login rejects invalid fields before verifying credentials', async () => {
  for (const input of [
    null,
    [],
    {},
    { email: 12, password: true },
    { email: 'ä@example.test', password: 'wrong' },
    { email: 'Kauthor@example.test', password: 'wrong' },
    { email: 'author@localhost', password: 'wrong' },
    { email: validInput.email, password: '' },
    { email: validInput.email, password: 'x'.repeat(129) },
    { email: validInput.email, password: '\ud800' },
    { email: validInput.email, password: 'wrong', userId: 7 },
  ]) {
    const response = await login(input);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.equal(loginInputs.length, 0);
});

test('login accepts short candidate passwords without applying the registration minimum again', async () => {
  const response = await login({ email: validInput.email, password: 'wrong' });
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.equal(loginInputs[0]?.input.password, 'wrong');
});

test('login rejects malformed JSON, oversized, non-JSON, non-UTF-8 and compressed requests', async () => {
  const cases: { body: string; status: number; headers: Record<string, string> }[] = [
    { body: '{"password":"secret"', status: 400, headers: { 'Content-Type': 'application/json' } },
    {
      body: JSON.stringify({ email: validInput.email, password: 'x'.repeat(16_384) }),
      status: 413,
      headers: { 'Content-Type': 'application/json' },
    },
    { body: '{}', status: 415, headers: { 'Content-Type': 'text/plain' } },
    {
      body: '{}',
      status: 415,
      headers: { 'Content-Type': 'application/json; charset=iso-8859-1' },
    },
    {
      body: '{}',
      status: 415,
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    },
  ];
  for (const { body, status, headers } of cases) {
    const response = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { ...headers, 'X-Hummingbird-Request': '1' },
      body,
    });
    assert.equal(response.status, status);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    await response.arrayBuffer();
  }
  assert.equal(loginInputs.length, 0);
});

test('rejected credentials return a generic 401 without setting a session cookie', async () => {
  authenticationError = new HttpError(401, 'Invalid email or password.');
  const response = await login();
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { error: { message: 'Invalid email or password.' } });
});

test('current-user lookup reads only the session cookie and exposes no credential fields', async () => {
  const response = await fetch(`${baseUrl}/api/auth/me?token=ignored`, {
    headers: {
      Cookie: `other=value; hummingbird_session=${sessionToken}`,
      Authorization: 'Bearer ignored',
    },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(userTokens, [sessionToken]);
  assert.deepEqual(await response.json(), {
    user: { id: 7, username: 'Author', email: validInput.email },
  });
});

test('missing or duplicate session cookies are not accepted and stale cookies are cleared', async () => {
  signedInUser = null;
  for (const cookie of [
    '',
    `hummingbird_session=${sessionToken}; hummingbird_session=${sessionToken}`,
  ]) {
    const response = await fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(
      response.headers.get('set-cookie')!,
      /^hummingbird_session=;.*Expires=Thu, 01 Jan 1970/,
    );
    assert.deepEqual(await response.json(), { error: { message: 'Please sign in.' } });
  }
  assert.deepEqual(userTokens, [undefined, undefined]);
});

test('logout revokes the cookie session and clears it, even if no cookie is supplied', async () => {
  for (const cookie of [`hummingbird_session=${sessionToken}`, '']) {
    const response = await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'X-Hummingbird-Request': '1', Cookie: cookie },
    });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(await response.text(), '');
    assert.match(
      response.headers.get('set-cookie')!,
      /^hummingbird_session=;.*Expires=Thu, 01 Jan 1970/,
    );
  }
  assert.deepEqual(logoutTokens, [sessionToken, undefined]);
  const unsafeGet = await fetch(`${baseUrl}/api/auth/logout`);
  assert.equal(unsafeGet.status, 404);
  await unsafeGet.arrayBuffer();
});

test('login and logout reject missing, incorrect and cross-site request headers before service access', async () => {
  const headerCases: Record<string, string>[] = [
    {},
    { 'X-Hummingbird-Request': '0' },
    { 'X-Hummingbird-Request': '1', 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const route of ['login', 'logout']) {
    for (const headers of headerCases) {
      const response = await fetch(`${baseUrl}/api/auth/${route}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: '{}',
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      await response.arrayBuffer();
    }
  }
  const preflight = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'X-Hummingbird-Request',
    },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
  await preflight.arrayBuffer();
  assert.equal(loginInputs.length, 0);
  assert.equal(logoutTokens.length, 0);
});

test('authentication failures return safe errors without issuing or clearing an unrevoked cookie', async () => {
  authenticationError = new Error('database failed; password secret; token secret');
  const responses = [
    await login(),
    await fetch(`${baseUrl}/api/auth/me`),
    await fetch(`${baseUrl}/api/auth/logout`, {
      method: 'POST',
      headers: { 'X-Hummingbird-Request': '1', Cookie: `hummingbird_session=${sessionToken}` },
    }),
  ];
  for (const response of responses) {
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), {
      error: { message: 'Unable to process the request. Try again later.' },
    });
  }
});

async function withApp(options: AuthOptions, check: (url: string) => Promise<void>) {
  const temporaryServer = createApp(options).listen(0, '127.0.0.1');
  try {
    await once(temporaryServer, 'listening');
    const address = temporaryServer.address();
    assert.ok(address && typeof address !== 'string');
    await check(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      temporaryServer.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('production cookies use the host prefix, Secure, and matching logout attributes', async () => {
  await withApp(
    { registerUser: async () => publicUser, authentication, secureCookies: true },
    async (url) => {
      const response = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hummingbird-Request': '1',
          Cookie:
            '__Host-hummingbird_session=production-old; hummingbird_session=development-ignored',
        },
        body: JSON.stringify({ email: validInput.email, password: validInput.password }),
      });
      assert.equal(response.status, 200);
      assert.equal(loginInputs[0]?.previousToken, 'production-old');
      const cookie = response.headers.get('set-cookie')!;
      assert.match(cookie, /^__Host-hummingbird_session=/);
      assert.match(cookie, /; Secure/);
      assert.match(cookie, /; HttpOnly/);
      assert.match(cookie, /; SameSite=Lax/);
      assert.match(cookie, /; Path=\//);
      assert.doesNotMatch(cookie, /; Domain=/);
      await response.arrayBuffer();
      const logoutResponse = await fetch(`${url}/api/auth/logout`, {
        method: 'POST',
        headers: { 'X-Hummingbird-Request': '1' },
      });
      assert.equal(logoutResponse.status, 204);
      const clearedCookie = logoutResponse.headers.get('set-cookie')!;
      assert.match(clearedCookie, /^__Host-hummingbird_session=;/);
      assert.match(clearedCookie, /; Secure/);
      assert.match(clearedCookie, /; HttpOnly/);
      assert.match(clearedCookie, /; SameSite=Lax/);
    },
  );
});

test('login limits attempts before service calls without blocking logout or current-user checks', async () => {
  await withApp({ registerUser: async () => publicUser, authentication }, async (url) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const response = await fetch(`${url}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Hummingbird-Request': '1' },
        body: JSON.stringify({ email: validInput.email, password: validInput.password }),
      });
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
    const blocked = await fetch(`${url}/api/auth/login`, { method: 'POST' });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.headers.get('cache-control'), 'no-store');
    assert.ok(blocked.headers.get('retry-after'));
    assert.deepEqual(await blocked.json(), {
      error: { message: 'Too many login attempts. Try again later.' },
    });
    assert.equal(loginInputs.length, 20);
    const me = await fetch(`${url}/api/auth/me`);
    assert.equal(me.status, 200);
    await me.arrayBuffer();
    const logoutResponse = await fetch(`${url}/api/auth/logout`, {
      method: 'POST',
      headers: { 'X-Hummingbird-Request': '1' },
    });
    assert.equal(logoutResponse.status, 204);
  });
});
