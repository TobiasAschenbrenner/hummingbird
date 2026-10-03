import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { afterEach, beforeEach, test } from 'node:test';

import type {
  CommentQueries,
  CreateCommentInput,
  CommentPageInput,
} from '../src/models/comment.model.ts';
import { createApp } from '../src/app.ts';
import { EmailAlreadyExistsError } from '../src/errors/email-already-exists.error.ts';
import type { RegistrationInput, PublicUser } from '../src/models/user.model.ts';
import type { AuthenticationService, LoginInput } from '../src/models/session.model.ts';
import { HttpError } from '../src/errors/http-error.ts';
import type { AuthOptions } from '../src/routes/auth.routes.ts';
import type {
  ArticleDetail,
  CreateArticleInput,
  UpdateArticleInput,
  DeleteArticleInput,
  ArticlePageInput,
  ArticleQueries,
} from '../src/models/article.model.ts';

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

const exampleArticle: ArticleDetail = {
  id: 11,
  slug: 'first-article',
  title: 'First article',
  description: 'An introduction.',
  imageFilename: null,
  createdAt: '2026-10-01T09:00:00.000Z',
  author: { id: 7, username: 'Author' },
  category: { id: 3, slug: 'tech', name: 'Tech' },
  tags: [{ id: 2, slug: 'databases', name: 'Databases' }],
  commentCount: 2,
  body: 'First paragraph.\n\nSecond paragraph.',
  version: '9007199254740993',
};
const catalogs = {
  async listCategories() {
    if (articleError) throw articleError;
    return [exampleArticle.category];
  },
  async listTags() {
    if (articleError) throw articleError;
    return exampleArticle.tags;
  },
};
let articleCreations: CreateArticleInput[] = [];
let articleUpdates: UpdateArticleInput[] = [];
let articleDeletions: DeleteArticleInput[] = [];
let articlePageInputs: ArticlePageInput[] = [];
let articleSlugs: string[] = [];
let articleError: Error | undefined;
const articles: ArticleQueries = {
  async createArticle(input) {
    articleCreations.push(input);
    if (articleError) throw articleError;
    return {
      ...exampleArticle,
      slug: input.slug,
      title: input.title,
      description: input.description,
      body: input.body,
      version: '1',
      commentCount: 0,
      author: { id: input.authorId, username: 'Author' },
      tags: exampleArticle.tags.filter((tag) => input.tagIds.includes(tag.id)),
    };
  },
  async updateArticle(input) {
    articleUpdates.push(input);
    if (articleError) throw articleError;
    return {
      ...exampleArticle,
      title: input.title,
      description: input.description,
      body: input.body,
      version: (BigInt(input.version) + 1n).toString(),
      tags: exampleArticle.tags.filter((tag) => input.tagIds.includes(tag.id)),
    };
  },
  async deleteArticle(input) {
    articleDeletions.push(input);
    if (articleError) throw articleError;
  },
  async listArticles({ page, pageSize }) {
    articlePageInputs.push({ page, pageSize });
    if (articleError) throw articleError;
    const { body: _body, version: _version, ...summary } = exampleArticle;
    return {
      articles: [summary].slice((page - 1) * pageSize, page * pageSize),
      pagination: { page, pageSize, total: 1, totalPages: 1 },
    };
  },
  async findArticleBySlug(slug) {
    articleSlugs.push(slug);
    if (articleError) throw articleError;
    return slug === exampleArticle.slug ? exampleArticle : null;
  },
};

let commentCreations: CreateCommentInput[] = [];
let commentPages: CommentPageInput[] = [];
let commentError: Error | undefined;
let commentCreated = true;
const exampleComment = {
  id: 21,
  articleId: exampleArticle.id,
  body: 'A useful article.',
  createdAt: exampleArticle.createdAt,
  author: { id: publicUser.id, username: publicUser.username },
};
const comments: CommentQueries = {
  async createComment(input) {
    commentCreations.push(input);
    if (commentError) throw commentError;
    return {
      created: commentCreated,
      comment: {
        ...exampleComment,
        body: input.body,
        author: { id: input.authorId, username: 'Author' },
      },
    };
  },
  async listComments(input) {
    commentPages.push(input);
    if (commentError) throw commentError;
    return {
      articleId: exampleArticle.id,
      comments: input.before ? [] : [exampleComment],
      total: 1,
      nextCursor: null,
    };
  },
};

const validInput = {
  username: 'Author',
  email: 'author@example.test',
  password: 'a long test password',
};

beforeEach(async () => {
  server = createApp({
    articles,
    comments,
    catalogs,
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
  articlePageInputs = [];
  articleCreations = [];
  articleUpdates = [];
  articleDeletions = [];
  articleSlugs = [];
  articleError = undefined;
  commentCreations = [];
  commentPages = [];
  commentError = undefined;
  commentCreated = true;
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
    articles,
    comments,
    catalogs,
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
  const temporaryServer = createApp({ ...options, articles, catalogs, comments }).listen(
    0,
    '127.0.0.1',
  );
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

test('article listing is public, paginated and returns summaries without reading a session', async () => {
  const response = await fetch(`${baseUrl}/api/articles`, {
    headers: { Cookie: 'hummingbird_session=stale-cookie' },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /application\/json/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const { body: _body, version: _version, ...summary } = exampleArticle;
  assert.deepEqual(await response.json(), {
    articles: [summary],
    pagination: { page: 1, pageSize: 12, total: 1, totalPages: 1 },
  });
  assert.deepEqual(articlePageInputs, [{ page: 1, pageSize: 12 }]);
  assert.deepEqual(userTokens, []);
});

test('article listing accepts bounded page sizes and returns empty pages without a 404', async () => {
  for (const [page, pageSize] of [
    [2, 1],
    [10_000, 50],
  ]) {
    const response = await fetch(`${baseUrl}/api/articles?page=${page}&pageSize=${pageSize}`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      articles: [],
      pagination: { page, pageSize, total: 1, totalPages: 1 },
    });
  }
  assert.deepEqual(articlePageInputs, [
    { page: 2, pageSize: 1 },
    { page: 10_000, pageSize: 50 },
  ]);
});

test('article listing rejects malformed, repeated and unsupported query parameters before querying', async () => {
  const queries = [
    'page=',
    'page=0',
    'page=-1',
    'page=1.5',
    'page=01',
    'page=+1',
    'page=1e2',
    'page=10001',
    'page=9007199254740993',
    'page=1&page=2',
    'page[]=1',
    'page[number]=1',
    'pageSize=',
    'pageSize=0',
    'pageSize=-2',
    'pageSize=51',
    'pageSize=2.5',
    'pageSize=2&pageSize=3',
    'pageSize[]=12',
    'q=search',
    'category=tech',
    'unknown=value',
    '__proto__=value',
  ];
  for (const query of queries) {
    const response = await fetch(`${baseUrl}/api/articles?${query}`);
    assert.equal(response.status, 400, query);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok((await response.json()).error.message);
  }
  assert.deepEqual(articlePageInputs, []);
});

test('article detail is public and preserves text, timestamps and a large version string', async () => {
  const response = await fetch(`${baseUrl}/api/articles/first-article`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), { article: exampleArticle });
  assert.deepEqual(articleSlugs, ['first-article']);
  assert.deepEqual(userTokens, []);
});

test('a valid missing article slug returns a safe article-specific 404', async () => {
  const response = await fetch(`${baseUrl}/api/articles/missing-article`);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { error: { message: 'Article not found.' } });
  assert.deepEqual(articleSlugs, ['missing-article']);
});

test('article slugs reject invalid paths and accept the documented length boundary', async () => {
  for (const slug of [
    'Uppercase',
    '-first',
    'first-',
    'first--article',
    'first_article',
    'a'.repeat(81),
    '%00',
    '%2F',
    '%FF',
    '%ZZ',
    '%F0%9F%90%A6',
    'first%27%20OR%201%3D1',
  ]) {
    const response = await fetch(`${baseUrl}/api/articles/${slug}`);
    assert.equal(response.status, 400, slug);
    await response.arrayBuffer();
  }
  assert.deepEqual(articleSlugs, []);
  for (const slug of ['1', 'a'.repeat(80)]) {
    const response = await fetch(`${baseUrl}/api/articles/${slug}`);
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
  assert.deepEqual(articleSlugs, ['1', 'a'.repeat(80)]);
});

test('article query failures produce safe JSON errors without leaking database details', async () => {
  articleError = new Error('SELECT users password_hash; postgresql://user:secret@localhost');
  for (const route of ['/api/articles', '/api/articles/first-article']) {
    const response = await fetch(`${baseUrl}${route}`);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), {
      error: { message: 'Unable to process the request. Try again later.' },
    });
  }
});

test('partial article updates are not implemented', async () => {
  for (const [method, route] of [['PATCH', '/api/articles/first-article']]) {
    const response = await fetch(`${baseUrl}${route}`, { method });
    assert.equal(response.status, 404);
    await response.arrayBuffer();
  }
  assert.deepEqual(articlePageInputs, []);
  assert.deepEqual(articleSlugs, []);
});

const validArticle = {
  slug: 'new-article',
  title: 'New article',
  description: 'An introduction.',
  body: 'First paragraph.\n\nSecond paragraph.',
  categoryId: 3,
  tagIds: [2],
};
function publish(body: unknown = validArticle, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}/api/articles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hummingbird-Request': '1',
      Cookie: `hummingbird_session=${sessionToken}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('category and tag options are public, uncached and contain only catalog fields', async () => {
  for (const [route, key, entries] of [
    ['categories', 'categories', [exampleArticle.category]],
    ['tags', 'tags', exampleArticle.tags],
  ] as const) {
    const response = await fetch(`${baseUrl}/api/${route}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { [key]: entries });
  }
  assert.deepEqual(userTokens, []);
});

test('catalog failures return safe errors without disclosing database details', async () => {
  articleError = new Error('SELECT users password_hash; secret');
  for (const route of ['categories', 'tags']) {
    const response = await fetch(`${baseUrl}/api/${route}`);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { message: 'Unable to process the request. Try again later.' },
    });
  }
});

test('publishing uses the cookie session author, normalizes labels and preserves plain body text', async () => {
  const body = '  Unicode 🐦 <script>plain text</script>\n\n\tSecond paragraph.  ';
  const response = await publish({
    ...validArticle,
    title: '  New article  ',
    description: '  An introduction.  ',
    body,
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('location'), '/api/articles/new-article');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('set-cookie'), null);
  const article = (await response.json()).article;
  assert.equal(article.author.id, publicUser.id);
  assert.equal(article.title, 'New article');
  assert.equal(article.body, body);
  assert.equal(article.version, '1');
  assert.deepEqual(Object.keys(article.author).sort(), ['id', 'username']);
  assert.deepEqual(articleCreations, [{ ...validArticle, body, authorId: publicUser.id }]);
  assert.deepEqual(userTokens, [sessionToken]);
});

test('publishing refuses missing or ambiguous sessions and clears stale cookies before reading the body', async () => {
  signedInUser = null;
  for (const cookie of [
    '',
    `hummingbird_session=${sessionToken}`,
    'hummingbird_session=one; hummingbird_session=two',
  ]) {
    const response = await fetch(`${baseUrl}/api/articles`, {
      method: 'POST',
      headers: { 'X-Hummingbird-Request': '1', Cookie: cookie },
      body: 'not JSON',
    });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: { message: 'Please sign in.' } });
    assert.match(response.headers.get('set-cookie')!, /^hummingbird_session=;/);
  }
  assert.deepEqual(articleCreations, []);
  assert.deepEqual(userTokens, [undefined, sessionToken, undefined]);
});

test('publishing rejects missing or cross-site request headers before authenticating or parsing', async () => {
  const headerCases: Record<string, string>[] = [
    {},
    { 'X-Hummingbird-Request': '0' },
    { 'X-Hummingbird-Request': '1', 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of headerCases) {
    const response = await fetch(`${baseUrl}/api/articles`, {
      method: 'POST',
      headers,
      body: 'not JSON',
    });
    assert.equal(response.status, 403);
    await response.arrayBuffer();
  }
  const preflight = await fetch(`${baseUrl}/api/articles`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://untrusted.example',
      'Access-Control-Request-Headers': 'X-Hummingbird-Request',
    },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  await preflight.arrayBuffer();
  assert.deepEqual(userTokens, []);
  assert.deepEqual(articleCreations, []);
});

test('publishing rejects nonobjects and client-supplied ownership or server-managed fields', async () => {
  for (const body of [
    null,
    [],
    'text',
    {},
    ...[
      'authorId',
      'author',
      'id',
      'version',
      'createdAt',
      'imageFilename',
      'tags',
      '__proto__',
    ].map((field) => ({ ...validArticle, [field]: 'untrusted' })),
  ]) {
    const response = await publish(body);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.deepEqual(articleCreations, []);
});

test('publishing validates slug and label types, Unicode lengths and control characters', async () => {
  for (const [field, value] of [
    ['slug', 'Uppercase'],
    ['slug', ' a-slug '],
    ['slug', 'double--hyphen'],
    ['slug', 'a'.repeat(81)],
    ['title', 42],
    ['title', '   '],
    ['title', '🐦'.repeat(56)],
    ['title', 'bad\u0000title'],
    ['title', '\ud800'],
    ['description', null],
    ['description', '\t '],
    ['description', '🐦'.repeat(251)],
    ['description', 'bad\nlabel'],
  ] as const) {
    const response = await publish({ ...validArticle, [field]: value });
    assert.equal(response.status, 400, field);
    assert.ok((await response.json()).error.fields[field]);
  }
  assert.deepEqual(articleCreations, []);
});

test('publishing validates body content and accepts boundary lengths without changing text', async () => {
  for (const body of [
    null,
    42,
    ' \t\n ',
    'x'.repeat(20_001),
    '\ud800',
    'bad\u0000body',
    'bad\u000bbody',
  ]) {
    const response = await publish({ ...validArticle, body });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.body);
  }
  const boundary = {
    ...validArticle,
    slug: 'a'.repeat(80),
    title: '🐦'.repeat(55),
    description: '🐦'.repeat(250),
    body: '🐦'.repeat(20_000),
    tagIds: Array.from({ length: 10 }, (_, i) => i + 1),
  };
  const response = await publish(boundary);
  assert.equal(response.status, 201);
  await response.arrayBuffer();
  assert.deepEqual(articleCreations, [{ ...boundary, authorId: publicUser.id }]);
  const { tagIds: _tagIds, ...withoutTags } = validArticle;
  const noTags = await publish(withoutTags);
  assert.equal(noTags.status, 201);
  assert.deepEqual((await noTags.json()).article.tags, []);
});

test('publishing rejects invalid category IDs and invalid, excessive or duplicate tag selections', async () => {
  for (const categoryId of [undefined, '3', 0, -1, 1.5, 2_147_483_648]) {
    const response = await publish({ ...validArticle, categoryId });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.categoryId);
  }
  for (const tagIds of [
    null,
    '2',
    [0],
    ['2'],
    [1.5],
    [2_147_483_648],
    [2, 2],
    Array.from({ length: 11 }, (_, i) => i + 1),
  ]) {
    const response = await publish({ ...validArticle, tagIds });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.tagIds);
  }
  assert.deepEqual(articleCreations, []);
});

test('publishing rejects malformed, oversized and unsupported JSON with safe errors', async () => {
  const cases: { body: string; status: number; headers?: Record<string, string> }[] = [
    { body: '{"body":"secret"', status: 400 },
    { body: JSON.stringify({ ...validArticle, body: 'x'.repeat(131_072) }), status: 413 },
    { body: '{}', status: 415, headers: { 'Content-Type': 'text/plain' } },
    { body: '{}', status: 415, headers: { 'Content-Type': 'application/json; charset=utf-16le' } },
    { body: '{}', status: 415, headers: { 'Content-Encoding': 'gzip' } },
  ];
  for (const item of cases) {
    const response = await fetch(`${baseUrl}/api/articles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hummingbird-Request': '1',
        Cookie: `hummingbird_session=${sessionToken}`,
        ...item.headers,
      },
      body: item.body,
    });
    assert.equal(response.status, item.status);
    assert.ok(!JSON.stringify(await response.json()).includes('secret'));
  }
  assert.deepEqual(articleCreations, []);
});

test('publishing preserves expected conflicts and hides unexpected persistence or authentication failures', async () => {
  articleError = new HttpError(409, 'An article with this slug already exists.', {
    slug: 'Choose another article slug.',
  });
  const conflict = await publish();
  assert.equal(conflict.status, 409);
  assert.ok((await conflict.json()).error.fields.slug);
  articleError = new Error('private SQL and password secret');
  const failure = await publish();
  assert.equal(failure.status, 500);
  assert.deepEqual(await failure.json(), {
    error: { message: 'Unable to process the request. Try again later.' },
  });
  authenticationError = new Error('private session token');
  const unavailableSession = await publish();
  assert.equal(unavailableSession.status, 500);
  assert.equal(unavailableSession.headers.get('set-cookie'), null);
  await unavailableSession.arrayBuffer();
  assert.equal(articleCreations.length, 2);
});

test('publishing uses the production cookie name and ignores the development cookie', async () => {
  await withApp(
    { registerUser: async () => publicUser, authentication, secureCookies: true },
    async (url) => {
      const response = await fetch(`${url}/api/articles`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hummingbird-Request': '1',
          Cookie: `__Host-hummingbird_session=${sessionToken}; hummingbird_session=ignored`,
        },
        body: JSON.stringify(validArticle),
      });
      assert.equal(response.status, 201);
      await response.arrayBuffer();
      assert.deepEqual(userTokens, [sessionToken]);
      signedInUser = null;
      const blocked = await fetch(`${url}/api/articles`, {
        method: 'POST',
        headers: { 'X-Hummingbird-Request': '1', Cookie: `hummingbird_session=${sessionToken}` },
      });
      assert.equal(blocked.status, 401);
      assert.match(blocked.headers.get('set-cookie')!, /^__Host-hummingbird_session=;.*Secure/);
      await blocked.arrayBuffer();
      assert.deepEqual(userTokens, [sessionToken, undefined]);
    },
  );
});

test('publishing limits writes before session access while keeping public reads available', async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await publish();
    assert.equal(response.status, 201);
    await response.arrayBuffer();
  }
  const blocked = await publish();
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('cache-control'), 'no-store');
  assert.ok(blocked.headers.get('retry-after'));
  await blocked.arrayBuffer();
  assert.equal(articleCreations.length, 20);
  assert.equal(userTokens.length, 20);
  const list = await fetch(`${baseUrl}/api/articles`);
  assert.equal(list.status, 200);
  await list.arrayBuffer();
});

const validUpdate = {
  title: 'Updated article',
  description: 'An updated introduction.',
  body: 'Updated body.',
  categoryId: 3,
  tagIds: [2],
  version: exampleArticle.version,
};
function editArticle(
  body: unknown = validUpdate,
  slug = exampleArticle.slug,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/articles/${slug}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-Hummingbird-Request': '1',
      Cookie: `hummingbird_session=${sessionToken}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('editing passes session ownership and exact version to persistence while preserving body text', async () => {
  const body = '  Unicode 🐦\n\n\tPlain text.  ';
  const response = await editArticle({
    ...validUpdate,
    title: '  Updated article  ',
    description: '  An updated introduction.  ',
    body,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { article } = await response.json();
  assert.equal(article.slug, exampleArticle.slug);
  assert.equal(article.version, '9007199254740994');
  assert.equal(article.body, body);
  assert.deepEqual(articleUpdates, [
    { ...validUpdate, body, slug: exampleArticle.slug, authorId: publicUser.id },
  ]);
});

test('editing rejects unsafe request headers and invalid sessions before parsing or updating', async () => {
  const unsafeHeaders: Record<string, string>[] = [
    { 'X-Hummingbird-Request': '0' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of unsafeHeaders) {
    const response = await editArticle(validUpdate, exampleArticle.slug, headers);
    assert.equal(response.status, 403);
    await response.arrayBuffer();
  }
  assert.deepEqual(userTokens, []);
  signedInUser = null;
  for (const Cookie of [
    '',
    `hummingbird_session=${sessionToken}`,
    'hummingbird_session=one; hummingbird_session=two',
  ]) {
    const response = await editArticle(validUpdate, exampleArticle.slug, { Cookie });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('set-cookie')!, /^hummingbird_session=;/);
    await response.arrayBuffer();
  }
  assert.deepEqual(articleUpdates, []);
});

test('editing requires a canonical positive bigint version and a full replacement tag selection', async () => {
  for (const version of [
    undefined,
    null,
    1,
    0,
    '',
    '0',
    '-1',
    '01',
    ' 1',
    '1.5',
    '1e3',
    '9223372036854775808',
    '9'.repeat(100),
  ]) {
    const response = await editArticle({ ...validUpdate, version });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.version);
  }
  const response = await editArticle({ ...validUpdate, tagIds: undefined });
  assert.equal(response.status, 400);
  assert.ok((await response.json()).error.fields.tagIds);
  assert.deepEqual(articleUpdates, []);
});

test('editing rejects server-managed fields, changed slugs and unsafe route slugs', async () => {
  for (const field of [
    'slug',
    'authorId',
    'author',
    'id',
    'createdAt',
    'imageFilename',
    'tags',
    '__proto__',
  ]) {
    const response = await editArticle({ ...validUpdate, [field]: 'untrusted' });
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  for (const slug of ['Uppercase', 'double--hyphen', 'a'.repeat(81)]) {
    const response = await editArticle(validUpdate, slug);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.deepEqual(articleUpdates, []);
});

test('editing applies the publishing text and relation validation rules', async () => {
  for (const [field, value] of [
    ['title', '🐦'.repeat(56)],
    ['description', 'bad\nlabel'],
    ['body', ' \t\n '],
    ['body', '\ud800'],
    ['categoryId', '3'],
    ['tagIds', [2, 2]],
  ] as const) {
    const response = await editArticle({ ...validUpdate, [field]: value });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields[field]);
  }
  const boundary = {
    ...validUpdate,
    title: '🐦'.repeat(55),
    description: '🐦'.repeat(250),
    body: '🐦'.repeat(20_000),
    tagIds: [],
  };
  const response = await editArticle(boundary);
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.deepEqual(articleUpdates, [
    { ...boundary, slug: exampleArticle.slug, authorId: publicUser.id },
  ]);
});

test('editing rejects malformed, oversized and unsupported request formats', async () => {
  for (const [body, headers, status] of [
    ['{"body":"private"', {}, 400],
    [JSON.stringify({ ...validUpdate, body: 'x'.repeat(131_072) }), {}, 413],
    ['{}', { 'Content-Type': 'text/plain' }, 415],
    ['{}', { 'Content-Type': 'application/json; charset=utf-16le' }, 415],
    ['{}', { 'Content-Encoding': 'gzip' }, 415],
  ] as const) {
    const response = await fetch(`${baseUrl}/api/articles/first-article`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Hummingbird-Request': '1',
        Cookie: `hummingbird_session=${sessionToken}`,
        ...headers,
      },
      body,
    });
    assert.equal(response.status, status);
    assert.ok(!JSON.stringify(await response.json()).includes('private'));
  }
  assert.deepEqual(articleUpdates, []);
});

test('editing preserves missing, ownership and stale-version errors and hides unexpected failures', async () => {
  for (const status of [403, 404, 409]) {
    articleError = new HttpError(
      status,
      'Safe rejection.',
      status === 409 ? { version: 'Load the latest article.' } : undefined,
    );
    const response = await editArticle();
    assert.equal(response.status, status);
    if (status === 409) assert.ok((await response.json()).error.fields.version);
    else await response.arrayBuffer();
  }
  articleError = new Error('private SQL and password');
  const failed = await editArticle();
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    error: { message: 'Unable to process the request. Try again later.' },
  });
});

test('publishing, editing and deletion share a write limit without blocking public reads', async () => {
  for (let attempt = 0; attempt < 5; attempt++) {
    for (const [request, status] of [
      [publish, 201],
      [editArticle, 200],
      [deleteArticle, 204],
    ] as const) {
      const response = await request();
      assert.equal(response.status, status);
      await response.arrayBuffer();
    }
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const response = await deleteArticle();
    assert.equal(response.status, 204);
    await response.arrayBuffer();
  }
  for (const request of [publish, editArticle, deleteArticle]) {
    const blocked = await request();
    assert.equal(blocked.status, 429);
    assert.ok(blocked.headers.get('retry-after'));
    await blocked.arrayBuffer();
  }
  assert.equal(articleDeletions.length, 10);
  const detail = await fetch(`${baseUrl}/api/articles/first-article`);
  assert.equal(detail.status, 200);
  await detail.arrayBuffer();
});

const validDeletion = { articleId: exampleArticle.id, version: exampleArticle.version };
function deleteArticle(
  body: unknown = validDeletion,
  slug = exampleArticle.slug,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api/articles/${slug}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'X-Hummingbird-Request': '1',
      Cookie: `hummingbird_session=${sessionToken}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('deletion passes session ownership, identity and exact bigint version and returns an empty uncached 204', async () => {
  const response = await deleteArticle();
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(articleDeletions, [
    { ...validDeletion, slug: exampleArticle.slug, authorId: publicUser.id },
  ]);
});

test('deletion rejects unsafe headers before session or persistence access', async () => {
  const unsafeHeaders: Record<string, string>[] = [
    { 'X-Hummingbird-Request': '' },
    { 'X-Hummingbird-Request': '0' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of unsafeHeaders) {
    const response = await deleteArticle(validDeletion, exampleArticle.slug, headers);
    assert.equal(response.status, 403);
    await response.arrayBuffer();
  }
  assert.deepEqual(userTokens, []);
  assert.deepEqual(articleDeletions, []);
});

test('deletion clears missing, revoked and ambiguous sessions before parsing the body', async () => {
  signedInUser = null;
  for (const Cookie of [
    '',
    `hummingbird_session=${sessionToken}`,
    'hummingbird_session=one; hummingbird_session=two',
  ]) {
    const response = await deleteArticle(null, exampleArticle.slug, { Cookie });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('set-cookie')!, /^hummingbird_session=;/);
    await response.arrayBuffer();
  }
  assert.deepEqual(articleDeletions, []);
});

test('deletion requires a canonical positive bigint version', async () => {
  for (const version of [
    undefined,
    null,
    1,
    '',
    '0',
    '-1',
    '01',
    ' 1',
    '1.5',
    '1e3',
    '9223372036854775808',
    '9'.repeat(100),
  ]) {
    const response = await deleteArticle({ ...validDeletion, version });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.version);
  }
  const maximum = await deleteArticle({ ...validDeletion, version: '9223372036854775807' });
  assert.equal(maximum.status, 204);
  await maximum.arrayBuffer();
  assert.equal(articleDeletions.length, 1);
});

test('deletion requires an integer article ID and rejects additional fields, nonobjects and unsafe slugs', async () => {
  for (const articleId of [undefined, null, '11', 0, -1, 1.5, 2147483648]) {
    const response = await deleteArticle({ ...validDeletion, articleId });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.articleId);
  }
  for (const body of [
    null,
    [],
    { ...validDeletion, authorId: 7 },
    { ...validDeletion, slug: 'another' },
  ]) {
    const response = await deleteArticle(body);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  for (const slug of ['Uppercase', 'double--hyphen', 'a'.repeat(81)]) {
    const response = await deleteArticle(validDeletion, slug);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.deepEqual(articleDeletions, []);
});

test('deletion rejects malformed, oversized and unsupported request formats without deleting', async () => {
  for (const [body, headers, status] of [
    ['{"private":', {}, 400],
    [JSON.stringify({ junk: 'x'.repeat(131072) }), {}, 413],
    ['{}', { 'Content-Type': 'text/plain' }, 415],
    ['{}', { 'Content-Type': 'application/json; charset=utf-16le' }, 415],
    ['{}', { 'Content-Encoding': 'gzip' }, 415],
  ] as const) {
    const response = await fetch(`${baseUrl}/api/articles/first-article`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Hummingbird-Request': '1',
        Cookie: `hummingbird_session=${sessionToken}`,
        ...headers,
      },
      body,
    });
    assert.equal(response.status, status);
    assert.ok(!JSON.stringify(await response.json()).includes('private'));
  }
  assert.deepEqual(articleDeletions, []);
});

test('deletion preserves missing, forbidden and conflict errors while hiding unexpected failures', async () => {
  for (const status of [403, 404, 409]) {
    articleError = new HttpError(
      status,
      'Safe rejection.',
      status === 409 ? { version: 'Load the latest article.' } : undefined,
    );
    const response = await deleteArticle();
    assert.equal(response.status, status);
    if (status === 409) assert.ok((await response.json()).error.fields.version);
    else await response.arrayBuffer();
  }
  articleError = new Error('private SQL and password');
  const failed = await deleteArticle();
  assert.equal(failed.status, 500);
  assert.deepEqual(await failed.json(), {
    error: { message: 'Unable to process the request. Try again later.' },
  });
});

const validComment = {
  articleId: exampleArticle.id,
  body: '  A useful article.\n\nThank you 🐦!  ',
  requestId: 'a1111111-b222-4333-8444-c55555555555',
};
function postComment(
  body: unknown = validComment,
  headers: Record<string, string> = {},
  slug = exampleArticle.slug,
) {
  return fetch(`${baseUrl}/api/articles/${slug}/comments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hummingbird-Request': '1',
      Cookie: `hummingbird_session=${sessionToken}`,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('comment pages are public, uncached and accept an optional bounded ID cursor', async () => {
  for (const suffix of ['', '?before=21']) {
    const response = await fetch(`${baseUrl}/api/articles/first-article/comments${suffix}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const page = await response.json();
    assert.equal(page.articleId, exampleArticle.id);
    assert.equal(page.total, 1);
    assert.equal(page.nextCursor, null);
    assert.ok(!JSON.stringify(page).includes('passwordHash'));
  }
  assert.deepEqual(commentPages, [
    { slug: exampleArticle.slug, before: undefined },
    { slug: exampleArticle.slug, before: 21 },
  ]);
  assert.deepEqual(userTokens, []);
});

test('comment reads reject malformed cursors, repeated parameters, unknown queries and unsafe slugs', async () => {
  for (const suffix of [
    '?before=0',
    '?before=-1',
    '?before=01',
    '?before=1.5',
    '?before=2147483648',
    '?before=1&before=2',
    '?page=1',
    '?before=',
  ]) {
    const response = await fetch(`${baseUrl}/api/articles/first-article/comments${suffix}`);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  for (const slug of ['Uppercase', 'a'.repeat(81)]) {
    const response = await fetch(`${baseUrl}/api/articles/${slug}/comments`);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.deepEqual(commentPages, []);
});

test('comment creation uses the session author, preserves text and normalizes request IDs for retries', async () => {
  const response = await postComment({
    ...validComment,
    requestId: validComment.requestId.toUpperCase(),
  });
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { comment } = await response.json();
  assert.equal(comment.body, validComment.body);
  assert.equal(comment.author.id, publicUser.id);
  assert.equal(comment.requestId, undefined);
  assert.deepEqual(commentCreations, [
    { ...validComment, slug: exampleArticle.slug, authorId: publicUser.id },
  ]);
  commentCreated = false;
  const replay = await postComment();
  assert.equal(replay.status, 200);
  assert.deepEqual(await replay.json(), { comment });
});

test('comments validate Unicode character lengths, whitespace and control characters before persistence', async () => {
  for (const body of [
    undefined,
    null,
    2,
    '',
    ' \t\n ',
    '\ud800',
    'bad\u0000text',
    'bad\u007ftext',
    '🐦'.repeat(2001),
  ]) {
    const response = await postComment({ ...validComment, body });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.body);
  }
  assert.deepEqual(commentCreations, []);
  for (const body of [
    '🐦'.repeat(2000),
    '  <script>plain text</script>\n\tPreserve whitespace.  ',
  ]) {
    const response = await postComment({ ...validComment, body });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).comment.body, body);
  }
});

test('comments require an integer article ID and UUID v4 and reject ownership or server-managed fields', async () => {
  for (const articleId of [undefined, '11', 0, -1, 1.5, 2147483648]) {
    const response = await postComment({ ...validComment, articleId });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.articleId);
  }
  for (const requestId of [
    undefined,
    '',
    1,
    'not-a-uuid',
    '11111111-2222-1333-8444-555555555555',
  ]) {
    const response = await postComment({ ...validComment, requestId });
    assert.equal(response.status, 400);
    assert.ok((await response.json()).error.fields.requestId);
  }
  for (const body of [
    null,
    [],
    { ...validComment, authorId: 99 },
    { ...validComment, createdAt: 'now' },
    { ...validComment, id: 99 },
  ]) {
    const response = await postComment(body);
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.deepEqual(commentCreations, []);
});

test('comments reject unsafe request headers and unavailable sessions before reading the body', async () => {
  const unsafe: Record<string, string>[] = [
    { 'X-Hummingbird-Request': '' },
    { 'X-Hummingbird-Request': '0' },
    { 'Sec-Fetch-Site': 'cross-site' },
  ];
  for (const headers of unsafe) {
    const response = await postComment(null, headers);
    assert.equal(response.status, 403);
    await response.arrayBuffer();
  }
  assert.deepEqual(userTokens, []);
  signedInUser = null;
  for (const Cookie of [
    '',
    `hummingbird_session=${sessionToken}`,
    'hummingbird_session=one; hummingbird_session=two',
  ]) {
    const response = await postComment(null, { Cookie });
    assert.equal(response.status, 401);
    assert.match(response.headers.get('set-cookie')!, /^hummingbird_session=;/);
    await response.arrayBuffer();
  }
  assert.deepEqual(commentCreations, []);
});

test('comment JSON rejects malformed, oversized, non-UTF8 and compressed requests without writing', async () => {
  for (const [body, headers, status] of [
    ['{"private":', {}, 400],
    [JSON.stringify({ body: 'x'.repeat(16384) }), {}, 413],
    ['{}', { 'Content-Type': 'text/plain' }, 415],
    ['{}', { 'Content-Type': 'application/json; charset=utf-16le' }, 415],
    ['{}', { 'Content-Encoding': 'gzip' }, 415],
  ] as const) {
    const response = await fetch(`${baseUrl}/api/articles/first-article/comments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hummingbird-Request': '1',
        Cookie: `hummingbird_session=${sessionToken}`,
        ...headers,
      },
      body,
    });
    assert.equal(response.status, status);
    assert.ok(!JSON.stringify(await response.json()).includes('private'));
  }
  assert.deepEqual(commentCreations, []);
});

test('comment routes preserve expected missing/conflict errors and hide database or authentication details', async () => {
  for (const status of [404, 409]) {
    commentError = new HttpError(status, 'Safe rejection.');
    const response = await postComment();
    assert.equal(response.status, status);
    await response.arrayBuffer();
  }
  commentError = new Error('private SQL and credentials');
  for (const response of [
    await postComment(),
    await fetch(`${baseUrl}/api/articles/first-article/comments`),
  ]) {
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { message: 'Unable to process the request. Try again later.' },
    });
  }
});

test('comment write limits are separate from public reads and article writes', async () => {
  for (let attempt = 0; attempt < 20; attempt++) {
    const response = await postComment();
    assert.equal(response.status, 201);
    await response.arrayBuffer();
  }
  const blocked = await postComment();
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers.get('retry-after'));
  await blocked.arrayBuffer();
  assert.equal(commentCreations.length, 20);
  const read = await fetch(`${baseUrl}/api/articles/first-article/comments`);
  assert.equal(read.status, 200);
  await read.arrayBuffer();
  const article = await publish();
  assert.equal(article.status, 201);
  await article.arrayBuffer();
});
