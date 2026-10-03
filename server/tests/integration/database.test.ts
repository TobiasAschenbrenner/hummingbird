import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { verify } from 'argon2';
import { after, afterEach, before, beforeEach, test } from 'node:test';

import { createApp } from '../../src/app.ts';
import { createCommentQueries } from '../../src/queries/comment.queries.ts';
import { randomUUID } from 'node:crypto';
import { createArticleQueries } from '../../src/queries/article.queries.ts';
import { createCatalogQueries } from '../../src/queries/catalog.queries.ts';
import { createSessionQueries } from '../../src/queries/session.queries.ts';
import { createAuthenticationService } from '../../src/services/authentication.service.ts';
import { createUserQueries } from '../../src/queries/user.queries.ts';
import { createRegistrationService } from '../../src/services/registration.service.ts';
import { createDatabaseClient } from '../../src/database/client.ts';
import { readTestDatabaseUrl } from '../helpers/database.ts';
import { seedDatabase } from '../../prisma/seed-database.ts';
import { DEMO_PASSWORD_DISABLED } from '../../prisma/seed-data.ts';

let database: ReturnType<typeof createDatabaseClient>;
let databaseVerified = false;
let server: Server | undefined;
let baseUrl: string;

before(async () => {
  const connectionString = readTestDatabaseUrl();
  const migration = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)),
      'migrate',
      'deploy',
    ],
    {
      cwd: fileURLToPath(new URL('../../', import.meta.url)),
      env: { ...process.env, DATABASE_URL: connectionString },
      encoding: 'utf8',
      timeout: 30_000,
    },
  );
  assert.equal(
    migration.status,
    0,
    'Test database migration failed; check its connection and permissions.',
  );

  database = createDatabaseClient(connectionString);
  const [connection] = await database.$queryRaw<
    { name: string }[]
  >`SELECT current_database() AS name`;
  assert.equal(connection?.name, decodeURIComponent(new URL(connectionString).pathname.slice(1)));
  databaseVerified = true;
});

async function startServer() {
  server = createApp({
    articles: createArticleQueries(database),
    comments: createCommentQueries(database),
    catalogs: createCatalogQueries(database),
    registerUser: createRegistrationService(createUserQueries(database)),
    authentication: createAuthenticationService(
      createUserQueries(database),
      createSessionQueries(database),
    ),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
}

async function clearDatabase() {
  assert.ok(databaseVerified, 'Refusing to clear an unverified database.');
  await database.$executeRaw`TRUNCATE TABLE public.sessions, public.comments, public.article_tags,
    public.articles, public.tags, public.categories, public.users RESTART IDENTITY CASCADE`;
}

beforeEach(async () => {
  await clearDatabase();
  await startServer();
});
afterEach(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
after(async () => {
  if (database) {
    try {
      if (databaseVerified) {
        await clearDatabase();
      }
    } finally {
      await database.$disconnect();
    }
  }
});

async function createArticle() {
  const author = await database.user.create({
    data: {
      username: 'Author',
      email: 'author@example.test',
      passwordHash: 'test-only-not-a-real-hash',
    },
  });
  const category = await database.category.create({
    data: { name: 'Technology', slug: 'technology' },
  });
  const article = await database.article.create({
    data: {
      title: 'First article',
      slug: 'first-article',
      description: 'An introduction.',
      body: 'Article content.',
      authorId: author.id,
      categoryId: category.id,
    },
  });
  return { author, category, article };
}

test('Prisma stores and joins the six blog tables with a shared tag', async () => {
  const { author, category, article } = await createArticle();
  const second = await database.article.create({
    data: {
      title: 'Second article',
      slug: 'second-article',
      description: 'Another introduction.',
      body: 'More content.',
      authorId: author.id,
      categoryId: category.id,
    },
  });
  const tag = await database.tag.create({ data: { name: 'Databases', slug: 'databases' } });
  await database.articleTag.createMany({
    data: [
      { articleId: article.id, tagId: tag.id },
      { articleId: second.id, tagId: tag.id },
    ],
  });
  await database.comment.create({
    data: { body: 'A useful article.', articleId: article.id, authorId: author.id },
  });

  const result = await database.article.findUniqueOrThrow({
    where: { id: article.id },
    include: { author: true, category: true, tags: { include: { tag: true } }, comments: true },
  });
  assert.equal(result.author.email, author.email);
  assert.equal(result.category.name, category.name);
  assert.equal(result.tags[0]?.tag.name, tag.name);
  assert.equal(result.comments[0]?.body, 'A useful article.');
  assert.equal(result.version, 1n);
  assert.ok(result.createdAt instanceof Date);
  assert.equal(await database.articleTag.count({ where: { tagId: tag.id } }), 2);
});

test('duplicate tag assignments roll back the entire nested article creation', async () => {
  const { author, category } = await createArticle();
  const tag = await database.tag.create({ data: { name: 'Databases', slug: 'databases' } });
  await assert.rejects(
    database.article.create({
      data: {
        title: 'Invalid article',
        slug: 'duplicate-tags',
        description: 'Duplicate links.',
        body: 'Content.',
        authorId: author.id,
        categoryId: category.id,
        tags: { create: [{ tagId: tag.id }, { tagId: tag.id }] },
      },
    }),
    { code: 'P2002' },
  );
  assert.equal(await database.article.count({ where: { slug: 'duplicate-tags' } }), 0);
  assert.equal(await database.articleTag.count(), 0);
});

test('email uniqueness and canonical storage apply to direct SQL too', async () => {
  await createArticle();
  await database.user.create({
    data: { username: 'Developer', email: 'developer@example.dev', passwordHash: 'test-hash' },
  });
  await assert.rejects(
    database.user.create({
      data: { username: 'Another author', email: 'author@example.test', passwordHash: 'test-hash' },
    }),
    { code: 'P2002' },
  );
  for (const email of [
    'Author@example.test',
    ' author@example.test ',
    '\tauthor@example.test\n',
    '\vauthor@example.test\v',
  ]) {
    await assert.rejects(
      database.$executeRaw`
      INSERT INTO users (username, email, password_hash) VALUES ('Another author', ${email}, 'test-hash')
    `,
      /users_email_canonical/,
    );
  }
});

test('foreign keys reject missing parents and protect referenced users and categories', async () => {
  const { author, category, article } = await createArticle();
  await assert.rejects(
    database.comment.create({
      data: { body: 'Orphan comment.', articleId: article.id, authorId: 99999 },
    }),
    { code: 'P2003' },
  );
  await assert.rejects(
    database.article.update({ where: { id: article.id }, data: { categoryId: 99999 } }),
    { code: 'P2003' },
  );
  await assert.rejects(database.category.delete({ where: { id: category.id } }), { code: 'P2003' });
  await assert.rejects(database.user.delete({ where: { id: author.id } }), { code: 'P2003' });

  const reader = await database.user.create({
    data: { username: 'Reader', email: 'reader@example.test', passwordHash: 'test-hash' },
  });
  await database.comment.create({
    data: { body: 'Reader comment.', articleId: article.id, authorId: reader.id },
  });
  await assert.rejects(database.user.delete({ where: { id: reader.id } }), { code: 'P2003' });
});

test('article deletion cascades only to comments and tag links', async () => {
  const { author, category, article } = await createArticle();
  const tag = await database.tag.create({ data: { name: 'Databases', slug: 'databases' } });
  await database.articleTag.create({ data: { articleId: article.id, tagId: tag.id } });
  await database.comment.create({
    data: { body: 'Comment.', articleId: article.id, authorId: author.id },
  });
  await database.article.delete({ where: { id: article.id } });

  assert.equal(await database.comment.count(), 0);
  assert.equal(await database.articleTag.count(), 0);
  assert.equal(await database.tag.count({ where: { id: tag.id } }), 1);
  assert.equal(await database.user.count({ where: { id: author.id } }), 1);
  assert.equal(await database.category.count({ where: { id: category.id } }), 1);
});

test('tag deletion removes its links without deleting the article', async () => {
  const { article } = await createArticle();
  const tag = await database.tag.create({ data: { name: 'Databases', slug: 'databases' } });
  await database.articleTag.create({ data: { articleId: article.id, tagId: tag.id } });
  await database.tag.delete({ where: { id: tag.id } });
  assert.equal(await database.articleTag.count(), 0);
  assert.equal(await database.article.count({ where: { id: article.id } }), 1);
});

test('database checks reject blank content, oversized comments and nonpositive versions', async () => {
  const { author, category, article } = await createArticle();
  for (const field of ['username', 'email', 'passwordHash'] as const) {
    await assert.rejects(
      database.user.update({ where: { id: author.id }, data: { [field]: '\t\n ' } }),
    );
  }
  for (const field of ['slug', 'title', 'description', 'body'] as const) {
    await assert.rejects(
      database.article.update({ where: { id: article.id }, data: { [field]: '\t\n ' } }),
    );
  }
  for (const field of ['name', 'slug'] as const) {
    await assert.rejects(
      database.category.update({ where: { id: category.id }, data: { [field]: '\t\n ' } }),
    );
    await assert.rejects(
      database.tag.create({ data: { name: 'Tag', slug: 'tag', [field]: '\t\n ' } }),
    );
  }
  for (const body of ['\t\n ', 'x'.repeat(2001)]) {
    await assert.rejects(
      database.comment.create({ data: { body, articleId: article.id, authorId: author.id } }),
    );
  }
  await assert.rejects(
    database.article.update({ where: { id: article.id }, data: { version: 0n } }),
  );
  const updated = await database.article.update({
    where: { id: article.id },
    data: { version: 9007199254740993n },
  });
  assert.equal(updated.version, 9007199254740993n);
  await database.comment.create({
    data: { body: 'x'.repeat(2000), articleId: article.id, authorId: author.id },
  });
});

test('failed transactions leave no partially stored records', async () => {
  await assert.rejects(
    database.$transaction(async (transaction) => {
      await transaction.user.create({
        data: { username: 'Author', email: 'author@example.test', passwordHash: 'test-hash' },
      });
      await transaction.category.create({ data: { name: 'Technology', slug: 'technology' } });
      await transaction.comment.create({
        data: { body: 'Missing parents.', articleId: 99999, authorId: 99999 },
      });
    }),
    { code: 'P2003' },
  );
  assert.equal(await database.user.count(), 0);
  assert.equal(await database.category.count(), 0);
  assert.equal(await database.comment.count(), 0);
});

async function readSeedSnapshot() {
  return Promise.all([
    database.user.findMany({ orderBy: { id: 'asc' } }),
    database.category.findMany({ orderBy: { id: 'asc' } }),
    database.tag.findMany({ orderBy: { id: 'asc' } }),
    database.article.findMany({ orderBy: { id: 'asc' } }),
    database.articleTag.findMany({ orderBy: [{ articleId: 'asc' }, { tagId: 'asc' }] }),
    database.comment.findMany({ orderBy: { id: 'asc' } }),
  ]);
}

test('default seed adds only missing categories and preserves custom catalog entries', async () => {
  await database.category.createMany({
    data: [
      { slug: 'tech', name: 'Custom technology name' },
      { slug: 'science', name: 'Science' },
    ],
  });
  assert.deepEqual(await seedDatabase(database), {
    categories: 2,
    users: 0,
    tags: 0,
    articles: 0,
    articleTags: 0,
    comments: 0,
  });
  assert.equal(
    (await database.category.findUniqueOrThrow({ where: { slug: 'tech' } })).name,
    'Custom technology name',
  );
  const before = await readSeedSnapshot();
  assert.deepEqual(await seedDatabase(database), {
    categories: 0,
    users: 0,
    tags: 0,
    articles: 0,
    articleTags: 0,
    comments: 0,
  });
  assert.deepEqual(await readSeedSnapshot(), before);
  assert.equal(await database.category.count(), 4);
  assert.equal(await database.user.count(), 0);
});

test('demo seed creates a connected dataset once with disabled accounts and fixed dates', async () => {
  assert.deepEqual(await seedDatabase(database, { demo: true }), {
    categories: 3,
    users: 2,
    tags: 3,
    articles: 3,
    articleTags: 5,
    comments: 2,
  });
  const article = await database.article.findUniqueOrThrow({
    where: { slug: 'demo-relational-databases' },
    include: {
      author: true,
      category: true,
      tags: { include: { tag: true } },
      comments: { include: { author: true } },
    },
  });
  assert.equal(article.author.passwordHash, DEMO_PASSWORD_DISABLED);
  assert.equal(article.author.email, 'author@hummingbird.example');
  assert.equal(article.category.slug, 'tech');
  assert.deepEqual(article.tags.map((link) => link.tag.slug).sort(), [
    'databases',
    'web-development',
  ]);
  assert.equal(article.comments[0]?.author.email, 'reader@hummingbird.example');
  assert.equal(article.createdAt.toISOString(), '2026-10-01T09:00:00.000Z');
  const sharedTag = await database.tag.findUniqueOrThrow({
    where: { slug: 'web-development' },
    include: { articles: true },
  });
  assert.equal(sharedTag.articles.length, 2);

  const before = await readSeedSnapshot();
  assert.deepEqual(await seedDatabase(database, { demo: true }), {
    categories: 0,
    users: 0,
    tags: 0,
    articles: 0,
    articleTags: 0,
    comments: 0,
  });
  assert.deepEqual(await readSeedSnapshot(), before);
});

test('rerunning the demo seed leaves user edits, removed links and other articles unchanged', async () => {
  await createArticle();
  await seedDatabase(database, { demo: true });
  const article = await database.article.findUniqueOrThrow({
    where: { slug: 'demo-relational-databases' },
  });
  await database.article.update({
    where: { id: article.id },
    data: { body: 'Edited content.', version: 2n },
  });
  await database.articleTag.deleteMany({ where: { articleId: article.id } });
  await database.comment.updateMany({
    where: { articleId: article.id },
    data: { body: 'Edited comment.' },
  });
  await database.category.update({ where: { slug: 'tech' }, data: { name: 'Changed category' } });
  await database.tag.update({ where: { slug: 'databases' }, data: { name: 'Changed tag' } });
  await database.user.update({
    where: { email: 'author@hummingbird.example' },
    data: { username: 'Changed author' },
  });
  const before = await readSeedSnapshot();
  await seedDatabase(database, { demo: true });
  assert.deepEqual(await readSeedSnapshot(), before);
});

test('a conflicting demo article slug leaves the existing article and its relationships untouched', async () => {
  const { article } = await createArticle();
  await database.article.update({
    where: { id: article.id },
    data: { slug: 'demo-relational-databases' },
  });
  const before = await database.article.findUniqueOrThrow({
    where: { id: article.id },
    include: { tags: true, comments: true },
  });
  const added = await seedDatabase(database, { demo: true });
  assert.equal(added.articles, 2);
  assert.deepEqual(
    await database.article.findUniqueOrThrow({
      where: { id: article.id },
      include: { tags: true, comments: true },
    }),
    before,
  );
});

test('a conflicting demo email aborts the seed without altering an existing login account', async () => {
  const { author } = await createArticle();
  await database.user.update({
    where: { id: author.id },
    data: { email: 'author@hummingbird.example' },
  });
  const before = await readSeedSnapshot();
  await assert.rejects(
    seedDatabase(database, { demo: true }),
    /demo email belongs to an existing login account/,
  );
  assert.deepEqual(await readSeedSnapshot(), before);
});

test('a database failure during demo comments rolls back every earlier seed insert', async () => {
  await createArticle();
  const before = await readSeedSnapshot();
  await database.$executeRaw`ALTER TABLE comments ADD CONSTRAINT seed_test_reject_comments CHECK (false)`;
  try {
    await assert.rejects(seedDatabase(database, { demo: true }));
    assert.deepEqual(await readSeedSnapshot(), before);
  } finally {
    await database.$executeRaw`ALTER TABLE comments DROP CONSTRAINT seed_test_reject_comments`;
  }
});

test('Prisma seed commands forward demo options and refuse production demo writes', async () => {
  const connectionString = readTestDatabaseUrl();
  function runSeed(args: string[], nodeEnv = 'test') {
    return spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)),
        'db',
        'seed',
        ...args,
      ],
      {
        cwd: fileURLToPath(new URL('../../', import.meta.url)),
        env: { ...process.env, DATABASE_URL: connectionString, NODE_ENV: nodeEnv },
        encoding: 'utf8',
        timeout: 30_000,
      },
    );
  }
  const defaults = runSeed([]);
  assert.equal(defaults.status, 0, 'Default seed command failed.');
  assert.match(defaults.stdout, /3 categories, 0 users/);
  assert.equal(await database.article.count(), 0);
  const demo = runSeed(['--', '--demo']);
  assert.equal(demo.status, 0, 'Demo seed command failed.');
  assert.match(demo.stdout, /2 users, 3 tags, 3 articles, 5 articleTags, 2 comments/);
  const before = await readSeedSnapshot();
  const production = runSeed(['--', '--demo'], 'production');
  assert.notEqual(production.status, 0);
  assert.match(production.stderr, /Seeding failed/);
  assert.deepEqual(await readSeedSnapshot(), before);
});

function registerAccount(email = 'author@example.test', password = 'a long test password') {
  return fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: '  Author 🐦  ', email, password }),
  });
}

test('registration stores a canonical email and verifiable hash, returning only public fields', async () => {
  const password = '  a lengthy 🔑 password  ';
  const response = await registerAccount('  Author@Example.Test  ', password);
  assert.equal(response.status, 201);
  const result = await response.json();
  const stored = await database.user.findUniqueOrThrow({ where: { email: 'author@example.test' } });
  assert.deepEqual(result, { user: { id: stored.id, username: 'Author 🐦', email: stored.email } });
  assert.match(stored.passwordHash, /^\$argon2id\$/);
  assert.equal(await verify(stored.passwordHash, password), true);
  assert.equal(await verify(stored.passwordHash, password.trim()), false);
  assert.equal(await database.user.count(), 1);
});

test('invalid registration never inserts a user', async () => {
  const response = await registerAccount('not an email', 'short');
  assert.equal(response.status, 400);
  await response.arrayBuffer();
  assert.equal(await database.user.count(), 0);
});

test('duplicate registration preserves the original account and hash', async () => {
  const initial = await registerAccount();
  assert.equal(initial.status, 201);
  await initial.arrayBuffer();
  const original = await database.user.findUniqueOrThrow({
    where: { email: 'author@example.test' },
  });
  const duplicate = await registerAccount('  AUTHOR@EXAMPLE.TEST  ', 'another lengthy password');
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), {
    error: { message: 'An account with this email already exists.' },
  });
  assert.equal(await database.user.count(), 1);
  assert.deepEqual(await database.user.findUniqueOrThrow({ where: { id: original.id } }), original);
});

test('concurrent registrations of the same normalized email create exactly one account', async () => {
  const responses = await Promise.all([
    registerAccount('Author@Example.Test'),
    registerAccount(' author@example.test '),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  await Promise.all(responses.map((response) => response.arrayBuffer()));
  assert.equal(await database.user.count(), 1);
});

test('display names are not account identifiers and may be shared', async () => {
  for (const email of ['one@example.test', 'two@example.test']) {
    const response = await registerAccount(email);
    assert.equal(response.status, 201);
    await response.arrayBuffer();
  }
  assert.equal(await database.user.count({ where: { username: 'Author 🐦' } }), 2);
});

test('a failed registration insert returns a safe error and leaves no partial account', async () => {
  await database.$executeRaw`ALTER TABLE users ADD CONSTRAINT registration_test_reject_users CHECK (false)`;
  try {
    const response = await registerAccount();
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { message: 'Unable to process the request. Try again later.' },
    });
    assert.equal(await database.user.count(), 0);
  } finally {
    await database.$executeRaw`ALTER TABLE users DROP CONSTRAINT registration_test_reject_users`;
  }
});

test('non-email uniqueness failures are not reported as duplicate email addresses', async () => {
  await database.user.create({
    data: { username: 'Author 🐦', email: 'existing@example.test', passwordHash: 'test-disabled' },
  });
  await database.$executeRaw`ALTER TABLE users ADD CONSTRAINT registration_test_unique_username UNIQUE (username)`;
  try {
    const response = await registerAccount();
    assert.equal(response.status, 500);
    await response.arrayBuffer();
    assert.equal(await database.user.count(), 1);
  } finally {
    await database.$executeRaw`ALTER TABLE users DROP CONSTRAINT registration_test_unique_username`;
  }
});

async function registerForLogin(password = 'a long test password') {
  const response = await registerAccount('author@example.test', password);
  assert.equal(response.status, 201);
  return (await response.json()).user as { id: number; username: string; email: string };
}

function signIn(email = 'author@example.test', password = 'a long test password', cookie?: string) {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Hummingbird-Request': '1',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ email, password }),
  });
}

function responseSession(response: Response) {
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie);
  const token = cookie.slice(cookie.indexOf('=') + 1);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  return { cookie, token, tokenHash: createHash('sha256').update(token).digest('hex') };
}

function currentUser(cookie: string) {
  return fetch(`${baseUrl}/api/auth/me`, { headers: { Cookie: cookie } });
}

test('login stores only a token hash, joins the current user and logout invalidates copied cookies', async () => {
  const password = '  a lengthy 🔑 password  ';
  const user = await registerForLogin(password);
  const loginResponse = await signIn('  AUTHOR@EXAMPLE.TEST  ', password);
  assert.equal(loginResponse.status, 200);
  assert.deepEqual(await loginResponse.json(), { user });
  const session = responseSession(loginResponse);
  const stored = await database.session.findUniqueOrThrow({
    where: { tokenHash: session.tokenHash },
  });
  assert.equal(stored.userId, user.id);
  assert.equal(stored.expiresAt.getTime() - stored.createdAt.getTime(), 86_400_000);
  assert.ok(!JSON.stringify(stored).includes(session.token));
  const me = await currentUser(session.cookie);
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user });
  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'X-Hummingbird-Request': '1', Cookie: session.cookie },
  });
  assert.equal(logoutResponse.status, 204);
  assert.equal(await database.session.count(), 0);
  const stale = await currentUser(session.cookie);
  assert.equal(stale.status, 401);
  await stale.arrayBuffer();
  const repeatedLogout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'X-Hummingbird-Request': '1', Cookie: session.cookie },
  });
  assert.equal(repeatedLogout.status, 204);
});

test('unknown accounts, wrong passwords, disabled demo accounts and malformed hashes fail identically', async () => {
  await registerForLogin();
  await seedDatabase(database, { demo: true });
  await database.user.create({
    data: {
      username: 'Broken hash',
      email: 'broken@example.test',
      passwordHash: '$argon2id$malformed',
    },
  });
  for (const [email, password] of [
    ['missing@example.test', 'any candidate password'],
    ['author@example.test', 'wrong'],
    ['author@hummingbird.example', 'any candidate password'],
    ['broken@example.test', 'any candidate password'],
  ]) {
    const response = await signIn(email, password);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
    assert.deepEqual(await response.json(), { error: { message: 'Invalid email or password.' } });
  }
  assert.equal(await database.session.count(), 0);
});

test('successful login rotates only the presented session and leaves other device sessions active', async () => {
  await registerForLogin();
  const firstResponse = await signIn();
  assert.equal(firstResponse.status, 200);
  await firstResponse.arrayBuffer();
  const first = responseSession(firstResponse);
  const otherDevice = await signIn();
  assert.equal(otherDevice.status, 200);
  await otherDevice.arrayBuffer();
  const other = responseSession(otherDevice);
  const rotated = await signIn('author@example.test', 'a long test password', first.cookie);
  assert.equal(rotated.status, 200);
  await rotated.arrayBuffer();
  const replacement = responseSession(rotated);
  assert.notEqual(replacement.token, first.token);
  assert.equal(await database.session.count(), 2);
  for (const [cookie, expectedStatus] of [
    [first.cookie, 401],
    [other.cookie, 200],
    [replacement.cookie, 200],
  ] as const) {
    const response = await currentUser(cookie);
    assert.equal(response.status, expectedStatus);
    await response.arrayBuffer();
  }
});

test('expired, malformed, forged and missing tokens cannot authenticate; login cleans up expired sessions', async () => {
  const user = await registerForLogin();
  const expiredHash = createHash('sha256').update('e'.repeat(43)).digest('hex');
  await database.session.create({
    data: {
      tokenHash: expiredHash,
      userId: user.id,
      createdAt: new Date(Date.now() - 2000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  for (const cookie of [
    `hummingbird_session=${'e'.repeat(43)}`,
    `hummingbird_session=${'f'.repeat(43)}`,
    'hummingbird_session=malformed',
    'hummingbird_session=%invalid',
    '',
  ]) {
    const response = await currentUser(cookie);
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
  const response = await signIn();
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  assert.equal(await database.session.count(), 1);
  assert.equal(await database.session.findUnique({ where: { tokenHash: expiredHash } }), null);
});

test('sessions survive a fresh database client and reflect current user data', async () => {
  const user = await registerForLogin();
  const response = await signIn();
  assert.equal(response.status, 200);
  await response.arrayBuffer();
  const session = responseSession(response);
  await database.user.update({ where: { id: user.id }, data: { username: 'Renamed author' } });
  const restartedDatabase = createDatabaseClient(readTestDatabaseUrl());
  try {
    const restartedAuth = createAuthenticationService(
      createUserQueries(restartedDatabase),
      createSessionQueries(restartedDatabase),
    );
    assert.deepEqual(await restartedAuth.getUser(session.token), {
      ...user,
      username: 'Renamed author',
    });
  } finally {
    await restartedDatabase.$disconnect();
  }
});

test('failed login and failed session insertion preserve the previous session without partial rotation', async () => {
  await registerForLogin();
  const initial = await signIn();
  assert.equal(initial.status, 200);
  await initial.arrayBuffer();
  const session = responseSession(initial);
  const wrongPassword = await signIn('author@example.test', 'wrong', session.cookie);
  assert.equal(wrongPassword.status, 401);
  await wrongPassword.arrayBuffer();
  await database.$executeRaw`ALTER TABLE sessions ADD CONSTRAINT auth_test_reject_new_sessions CHECK (false) NOT VALID`;
  try {
    const failed = await signIn('author@example.test', 'a long test password', session.cookie);
    assert.equal(failed.status, 500);
    assert.equal(failed.headers.get('set-cookie'), null);
    await failed.arrayBuffer();
    assert.equal(await database.session.count(), 1);
    const preserved = await currentUser(session.cookie);
    assert.equal(preserved.status, 200);
    await preserved.arrayBuffer();
  } finally {
    await database.$executeRaw`ALTER TABLE sessions DROP CONSTRAINT auth_test_reject_new_sessions`;
  }
});

test('session SQL constraints enforce token hashes, expiry, foreign keys, uniqueness and user deletion', async () => {
  const user = await registerForLogin();
  const now = new Date();
  const valid = {
    tokenHash: 'a'.repeat(64),
    userId: user.id,
    createdAt: now,
    expiresAt: new Date(now.getTime() + 1000),
  };
  await database.session.create({ data: valid });
  await assert.rejects(database.session.create({ data: valid }), { code: 'P2002' });
  await assert.rejects(
    database.session.create({ data: { ...valid, tokenHash: 'b'.repeat(64), userId: 99999 } }),
    { code: 'P2003' },
  );
  for (const tokenHash of ['plaintext-token', 'A'.repeat(64)]) {
    await assert.rejects(
      database.session.create({ data: { ...valid, tokenHash } }),
      /sessions_token_hash_format/,
    );
  }
  await assert.rejects(
    database.session.create({ data: { ...valid, tokenHash: 'c'.repeat(64), expiresAt: now } }),
    /sessions_expiry_after_creation/,
  );
  await database.user.delete({ where: { id: user.id } });
  assert.equal(await database.session.count(), 0);
});

test('article read API returns an empty catalog and a 404 for a missing article', async () => {
  const list = await fetch(`${baseUrl}/api/articles`);
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), {
    articles: [],
    pagination: { page: 1, pageSize: 12, total: 0, totalPages: 0 },
  });
  const missing = await fetch(`${baseUrl}/api/articles/missing-article`);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: { message: 'Article not found.' } });
});

test('article listing reads seed relationships without exposing accounts, bodies or comment content', async () => {
  await seedDatabase(database, { demo: true });
  const response = await fetch(`${baseUrl}/api/articles`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.pagination, { page: 1, pageSize: 12, total: 3, totalPages: 1 });
  assert.deepEqual(
    result.articles.map((article: { slug: string }) => article.slug),
    ['demo-mobile-reading', 'demo-readable-blog', 'demo-relational-databases'],
  );
  const stored = await database.article.findUniqueOrThrow({
    where: { slug: 'demo-relational-databases' },
    include: { author: true, category: true, tags: { include: { tag: true } } },
  });
  assert.deepEqual(result.articles[2], {
    id: stored.id,
    slug: stored.slug,
    title: stored.title,
    description: stored.description,
    imageFilename: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    author: { id: stored.author.id, username: 'Demo Author' },
    category: { id: stored.category.id, slug: 'tech', name: 'Tech' },
    tags: stored.tags
      .map(({ tag }) => tag)
      .sort((first, second) => first.name.localeCompare(second.name)),
    commentCount: 1,
  });
  assert.deepEqual(
    result.articles.map((article: { commentCount: number }) => article.commentCount),
    [0, 1, 1],
  );
  const json = JSON.stringify(result);
  for (const privateValue of [
    'passwordHash',
    'password_hash',
    'email',
    'tokenHash',
    'sessions',
    'body',
    'version',
  ]) {
    assert.ok(!json.includes(`"${privateValue}"`), privateValue);
  }
});

test('article pagination is deterministic across tied timestamps and uses creation time before IDs', async () => {
  const { author, category, article } = await createArticle();
  const timestamp = new Date('2026-10-01T10:00:00Z');
  await database.article.update({ where: { id: article.id }, data: { createdAt: timestamp } });
  const tied = await database.article.create({
    data: {
      title: 'Tied article',
      slug: 'tied-article',
      description: 'Same timestamp.',
      body: 'Tied body.',
      createdAt: timestamp,
      authorId: author.id,
      categoryId: category.id,
    },
  });
  const older = await database.article.create({
    data: {
      title: 'Older article',
      slug: 'older-article',
      description: 'Higher ID, older timestamp.',
      body: 'Older body.',
      createdAt: new Date('2026-10-01T09:00:00Z'),
      authorId: author.id,
      categoryId: category.id,
    },
  });
  const ids: number[] = [];
  for (const page of [1, 2, 3, 4]) {
    const response = await fetch(`${baseUrl}/api/articles?page=${page}&pageSize=1`);
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.pagination, { page, pageSize: 1, total: 3, totalPages: 3 });
    assert.equal(result.articles.length, page <= 3 ? 1 : 0);
    ids.push(...result.articles.map((item: { id: number }) => item.id));
  }
  assert.deepEqual(ids, [tied.id, article.id, older.id]);
});

test('article summaries keep shared tags unique, sort them by name and count comments independently', async () => {
  const { author, article } = await createArticle();
  const tags = [];
  for (const [slug, name] of [
    ['zulu', 'Zulu'],
    ['alpha-one', 'Alpha'],
    ['alpha-two', 'Alpha'],
  ] as const) {
    tags.push(await database.tag.create({ data: { slug, name } }));
  }
  await database.articleTag.createMany({
    data: tags.map((tag) => ({ articleId: article.id, tagId: tag.id })),
  });
  await database.comment.createMany({
    data: [
      { body: 'First comment.', articleId: article.id, authorId: author.id },
      { body: 'Second comment.', articleId: article.id, authorId: author.id },
    ],
  });
  const response = await fetch(`${baseUrl}/api/articles`);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.pagination.total, 1);
  assert.equal(result.articles.length, 1);
  assert.deepEqual(result.articles[0].tags, [tags[1], tags[2], tags[0]]);
  assert.equal(result.articles[0].commentCount, 2);
});

test('article detail serializes PostgreSQL bigint versions exactly and preserves stored text', async () => {
  const { author, category, article } = await createArticle();
  const body = 'Unicode 🐦 and <script>plain text</script>.\n\nSecond paragraph.';
  await database.article.update({
    where: { id: article.id },
    data: {
      body,
      version: 9_007_199_254_740_993n,
      imageFilename: 'test-cover.webp',
      createdAt: new Date('2026-10-01T09:00:00Z'),
    },
  });
  const response = await fetch(`${baseUrl}/api/articles/first-article`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('set-cookie'), null);
  assert.deepEqual(await response.json(), {
    article: {
      id: article.id,
      slug: article.slug,
      title: article.title,
      description: article.description,
      imageFilename: 'test-cover.webp',
      createdAt: '2026-10-01T09:00:00.000Z',
      author: { id: author.id, username: author.username },
      category: { id: category.id, slug: category.slug, name: category.name },
      tags: [],
      commentCount: 0,
      body,
      version: '9007199254740993',
    },
  });
});

test('article reads reflect edited relations, comment deletion and article deletion without writes', async () => {
  const { author, article } = await createArticle();
  const comment = await database.comment.create({
    data: { body: 'Comment.', articleId: article.id, authorId: author.id },
  });
  const first = await fetch(`${baseUrl}/api/articles/first-article`);
  assert.equal(first.status, 200);
  assert.equal((await first.json()).article.commentCount, 1);
  await database.user.update({ where: { id: author.id }, data: { username: 'Renamed author' } });
  await database.comment.delete({ where: { id: comment.id } });
  const edited = await fetch(`${baseUrl}/api/articles/first-article`);
  assert.equal(edited.status, 200);
  const result = (await edited.json()).article;
  assert.equal(result.author.username, 'Renamed author');
  assert.equal(result.commentCount, 0);
  assert.equal(result.version, '1');
  assert.equal(await database.session.count(), 0);
  await database.article.delete({ where: { id: article.id } });
  const deleted = await fetch(`${baseUrl}/api/articles/first-article`);
  assert.equal(deleted.status, 404);
  await deleted.arrayBuffer();
  const listing = await fetch(`${baseUrl}/api/articles`);
  assert.equal(listing.status, 200);
  assert.equal((await listing.json()).pagination.total, 0);
});

async function publicationContext() {
  const user = await registerForLogin();
  await seedDatabase(database, { demo: false });
  const category = await database.category.findUniqueOrThrow({ where: { slug: 'tech' } });
  const tags = [];
  for (const [slug, name] of [
    ['zulu', 'Zulu'],
    ['alpha', 'Alpha'],
  ] as const) {
    tags.push(await database.tag.create({ data: { slug, name } }));
  }
  const login = await signIn();
  assert.equal(login.status, 200);
  await login.arrayBuffer();
  const { cookie } = responseSession(login);
  const input = {
    slug: 'published-article',
    title: 'Published article',
    description: 'A useful introduction.',
    body: 'First paragraph.\n\nSecond paragraph.',
    categoryId: category.id,
    tagIds: tags.map((tag) => tag.id),
  };
  return { user, category, tags, cookie, input };
}
function publishArticle(cookie: string, body: unknown) {
  return fetch(`${baseUrl}/api/articles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hummingbird-Request': '1', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

test('catalog routes read empty lists and stable alphabetical category and tag options without writes', async () => {
  for (const key of ['categories', 'tags']) {
    const empty = await fetch(`${baseUrl}/api/${key}`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { [key]: [] });
  }
  await seedDatabase(database, { demo: true });
  const duplicateName = await database.tag.create({
    data: { slug: 'another-databases', name: 'Databases' },
  });
  const before = await readSeedSnapshot();
  const categories = await fetch(`${baseUrl}/api/categories`);
  assert.deepEqual(
    (await categories.json()).categories.map((item: { name: string }) => item.name),
    ['Design', 'Mobile', 'Tech'],
  );
  const tags = await fetch(`${baseUrl}/api/tags`);
  const result = (await tags.json()).tags;
  const firstDatabases = await database.tag.findUniqueOrThrow({ where: { slug: 'databases' } });
  assert.deepEqual(result.map((item: { id: number }) => item.id).slice(0, 2), [
    firstDatabases.id,
    duplicateName.id,
  ]);
  assert.deepEqual(
    result.map((item: { name: string }) => item.name),
    ['Databases', 'Databases', 'User Experience', 'Web Development'],
  );
  assert.deepEqual(await readSeedSnapshot(), before);
});

test('publishing persists the signed-in author, category and shared tags and returns readable detail', async () => {
  const { user, category, tags, cookie, input } = await publicationContext();
  const before = Date.now();
  const response = await publishArticle(cookie, input);
  assert.equal(response.status, 201);
  assert.equal(response.headers.get('location'), '/api/articles/published-article');
  const article = (await response.json()).article;
  assert.deepEqual(article.author, { id: user.id, username: user.username });
  assert.deepEqual(article.category, category);
  assert.deepEqual(article.tags, [tags[1], tags[0]]);
  assert.equal(article.body, input.body);
  assert.equal(article.imageFilename, null);
  assert.equal(article.version, '1');
  assert.equal(article.commentCount, 0);
  assert.ok(
    Date.parse(article.createdAt) >= before - 1 && Date.parse(article.createdAt) <= Date.now(),
  );
  const stored = await database.article.findUniqueOrThrow({
    where: { slug: input.slug },
    include: { tags: true },
  });
  assert.equal(stored.authorId, user.id);
  assert.equal(stored.categoryId, category.id);
  assert.equal(stored.tags.length, 2);
  assert.equal(await database.tag.count(), 2);
  const detail = await fetch(`${baseUrl}${response.headers.get('location')}`);
  assert.deepEqual(await detail.json(), { article });
  const list = await fetch(`${baseUrl}/api/articles`);
  const { body: _body, version: _version, ...summary } = article;
  assert.deepEqual((await list.json()).articles, [summary]);
});

test('publishing preserves Unicode boundary lengths and whitespace and permits articles without tags', async () => {
  const { cookie, input } = await publicationContext();
  const { tagIds: _tags, ...withoutTags } = input;
  const body = '  🐦\n\n' + 'x'.repeat(19_993) + '\t ';
  assert.equal([...body].length, 20_000);
  const response = await publishArticle(cookie, {
    ...withoutTags,
    slug: 'a'.repeat(80),
    title: '  ' + '🐦'.repeat(55) + '  ',
    description: '  ' + '🐦'.repeat(250) + '  ',
    body,
  });
  assert.equal(response.status, 201);
  const article = (await response.json()).article;
  assert.equal([...article.title].length, 55);
  assert.equal([...article.description].length, 250);
  assert.equal(article.body, body);
  assert.deepEqual(article.tags, []);
  assert.equal(await database.articleTag.count(), 0);
});

test('nonexistent categories and tags return field errors without inserting articles or catalog entries', async () => {
  const { cookie, input } = await publicationContext();
  for (const [fields, expected] of [
    [{ categoryId: 99999 }, ['categoryId']],
    [{ tagIds: [input.tagIds[0], 99999] }, ['tagIds']],
    [{ categoryId: 99999, tagIds: [99999] }, ['categoryId', 'tagIds']],
  ] as const) {
    const response = await publishArticle(cookie, { ...input, ...fields });
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys((await response.json()).error.fields).sort(), [...expected]);
  }
  assert.equal(await database.article.count(), 0);
  assert.equal(await database.articleTag.count(), 0);
  assert.equal(await database.category.count(), 3);
  assert.equal(await database.tag.count(), 2);
});

test('expired, forged, duplicate and revoked sessions cannot publish or create tag links', async () => {
  const { user, cookie, input } = await publicationContext();
  const token = 'e'.repeat(43);
  await database.session.create({
    data: {
      tokenHash: createHash('sha256').update(token).digest('hex'),
      userId: user.id,
      createdAt: new Date(Date.now() - 2000),
      expiresAt: new Date(Date.now() - 1000),
    },
  });
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'X-Hummingbird-Request': '1', Cookie: cookie },
  });
  assert.equal(logout.status, 204);
  for (const invalid of [
    '',
    cookie,
    `hummingbird_session=${token}`,
    `hummingbird_session=${'f'.repeat(43)}`,
    `${cookie}; ${cookie}`,
  ]) {
    const response = await publishArticle(invalid, input);
    assert.equal(response.status, 401);
    await response.arrayBuffer();
  }
  assert.equal(await database.article.count(), 0);
  assert.equal(await database.articleTag.count(), 0);
});

test('client-provided author IDs are rejected instead of transferring ownership to another user', async () => {
  const { cookie, input } = await publicationContext();
  const other = await database.user.create({
    data: {
      username: 'Other author',
      email: 'other@example.test',
      passwordHash: 'disabled-test-account',
    },
  });
  const response = await publishArticle(cookie, { ...input, authorId: other.id });
  assert.equal(response.status, 400);
  await response.arrayBuffer();
  assert.equal(await database.article.count(), 0);
});

test('duplicate slugs preserve the original article and links, including concurrent publication', async () => {
  const { cookie, input } = await publicationContext();
  const responses = await Promise.all([
    publishArticle(cookie, input),
    publishArticle(cookie, { ...input, title: 'Conflicting title' }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  const created = await responses.find((response) => response.status === 201)!.json();
  const conflict = await responses.find((response) => response.status === 409)!.json();
  assert.ok(conflict.error.fields.slug);
  const duplicate = await publishArticle(cookie, { ...input, body: 'Changed body.', tagIds: [] });
  assert.equal(duplicate.status, 409);
  await duplicate.arrayBuffer();
  assert.equal(await database.article.count(), 1);
  assert.equal(await database.articleTag.count(), 2);
  const stored = await database.article.findUniqueOrThrow({ where: { slug: input.slug } });
  assert.equal(stored.title, created.article.title);
  assert.equal(stored.body, input.body);
});

test('a tag-link insert failure rolls back the article insert and all links, allowing a later retry', async () => {
  const { cookie, input } = await publicationContext();
  await database.$executeRaw`ALTER TABLE article_tags ADD CONSTRAINT publishing_test_reject_tag CHECK (false) NOT VALID`;
  try {
    const failed = await publishArticle(cookie, input);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), {
      error: { message: 'Unable to process the request. Try again later.' },
    });
    assert.equal(await database.article.count(), 0);
    assert.equal(await database.articleTag.count(), 0);
    assert.equal(await database.tag.count(), 2);
    assert.equal(await database.user.count(), 1);
  } finally {
    await database.$executeRaw`ALTER TABLE article_tags DROP CONSTRAINT publishing_test_reject_tag`;
  }
  const retried = await publishArticle(cookie, input);
  assert.equal(retried.status, 201);
  await retried.arrayBuffer();
  assert.equal(await database.article.count(), 1);
  assert.equal(await database.articleTag.count(), 2);
});

test('foreign-key failures return a safe relationship conflict without a partial article', async () => {
  const { input } = await publicationContext();
  await assert.rejects(
    createArticleQueries(database).createArticle({ ...input, authorId: 99999 }),
    {
      status: 409,
      message: 'Selected article relationships changed. Reload the options and try again.',
    },
  );
  assert.equal(await database.article.count(), 0);
  assert.equal(await database.articleTag.count(), 0);
});

test('unrelated uniqueness failures are not mislabeled as duplicate article slugs', async () => {
  const { cookie, input } = await publicationContext();
  const first = await publishArticle(cookie, input);
  assert.equal(first.status, 201);
  await first.arrayBuffer();
  await database.$executeRaw`ALTER TABLE articles ADD CONSTRAINT publishing_test_unique_title UNIQUE (title)`;
  try {
    const response = await publishArticle(cookie, { ...input, slug: 'another-slug' });
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      error: { message: 'Unable to process the request. Try again later.' },
    });
    assert.equal(await database.article.count(), 1);
    assert.equal(await database.articleTag.count(), 2);
  } finally {
    await database.$executeRaw`ALTER TABLE articles DROP CONSTRAINT publishing_test_unique_title`;
  }
});

function updateArticle(cookie: string, slug: string, input: unknown) {
  return fetch(`${baseUrl}/api/articles/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Hummingbird-Request': '1', Cookie: cookie },
    body: JSON.stringify(input),
  });
}
async function editingContext() {
  const context = await publicationContext();
  const created = await publishArticle(context.cookie, context.input);
  assert.equal(created.status, 201);
  const { article } = await created.json();
  const { slug: _slug, ...content } = context.input;
  return { ...context, article, update: { ...content, version: article.version } };
}

test('editing replaces content, category and tags atomically while preserving ownership, URL, date, image and comments', async () => {
  const { user, article, cookie, update, tags } = await editingContext();
  const category = await database.category.findUniqueOrThrow({ where: { slug: 'design' } });
  await database.article.update({
    where: { id: article.id },
    data: { imageFilename: 'existing-cover.webp' },
  });
  await database.comment.create({
    data: { body: 'Keep this comment.', authorId: user.id, articleId: article.id },
  });
  const body = '  Updated 🐦\n\n\tPlain text.  ';
  const response = await updateArticle(cookie, article.slug, {
    ...update,
    title: '  Updated title  ',
    body,
    categoryId: category.id,
    tagIds: [tags[1]!.id],
  });
  assert.equal(response.status, 200);
  const result = (await response.json()).article;
  assert.equal(result.title, 'Updated title');
  assert.equal(result.body, body);
  assert.equal(result.version, '2');
  assert.equal(result.id, article.id);
  assert.equal(result.slug, article.slug);
  assert.equal(result.createdAt, article.createdAt);
  assert.equal(result.imageFilename, 'existing-cover.webp');
  assert.equal(result.author.id, user.id);
  assert.equal(result.category.id, category.id);
  assert.deepEqual(
    result.tags.map((tag: { id: number }) => tag.id),
    [tags[1]!.id],
  );
  assert.equal(result.commentCount, 1);
  const stored = await database.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(stored.version, 2n);
  assert.equal(stored.body, body);
  assert.equal(await database.tag.count(), 2);
  const detail = await fetch(`${baseUrl}/api/articles/${article.slug}`);
  assert.deepEqual((await detail.json()).article, result);
  const cleared = await updateArticle(cookie, article.slug, {
    ...update,
    version: '2',
    tagIds: [],
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual((await cleared.json()).article.tags, []);
  assert.equal(await database.articleTag.count(), 0);
  assert.equal(await database.comment.count(), 1);
});

test('other authors, missing articles and revoked sessions cannot update article data or links', async () => {
  const { cookie, article, update } = await editingContext();
  const otherAccount = await registerAccount('other@example.test');
  assert.equal(otherAccount.status, 201);
  await otherAccount.arrayBuffer();
  const login = await signIn('other@example.test');
  assert.equal(login.status, 200);
  await login.arrayBuffer();
  const otherCookie = responseSession(login).cookie;
  const before = await readSeedSnapshot();
  const forbidden = await updateArticle(otherCookie, article.slug, update);
  assert.equal(forbidden.status, 403);
  await forbidden.arrayBuffer();
  const missing = await updateArticle(cookie, 'missing-article', update);
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  assert.deepEqual(await readSeedSnapshot(), before);
  await database.session.deleteMany();
  const denied = await updateArticle(cookie, article.slug, update);
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('set-cookie')!, /^hummingbird_session=;/);
  await denied.arrayBuffer();
  assert.equal(
    (await database.article.findUniqueOrThrow({ where: { id: article.id } })).version,
    1n,
  );
  assert.equal(await database.articleTag.count(), 2);
});

test('stale edits do not overwrite a newer save or its tag relationships', async () => {
  const { cookie, article, update, tags } = await editingContext();
  const saved = await updateArticle(cookie, article.slug, {
    ...update,
    title: 'Winning edit',
    tagIds: [tags[0]!.id],
  });
  assert.equal(saved.status, 200);
  await saved.arrayBuffer();
  const before = await readSeedSnapshot();
  const stale = await updateArticle(cookie, article.slug, {
    ...update,
    title: 'Stale edit',
    tagIds: [],
  });
  assert.equal(stale.status, 409);
  assert.ok((await stale.json()).error.fields.version);
  assert.deepEqual(await readSeedSnapshot(), before);
});

test('two concurrent saves of one version produce exactly one winner with matching content and tags', async () => {
  const { cookie, article, update, tags } = await editingContext();
  const candidates = [
    { ...update, title: 'First concurrent edit', tagIds: [tags[0]!.id] },
    { ...update, title: 'Second concurrent edit', tagIds: [tags[1]!.id] },
  ];
  const responses = await Promise.all(
    candidates.map((input) => updateArticle(cookie, article.slug, input)),
  );
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  const winnerIndex = responses.findIndex((response) => response.status === 200);
  const result = (await responses[winnerIndex]!.json()).article;
  const loser = (await responses[1 - winnerIndex]!.json()).error;
  assert.ok(loser.fields.version);
  assert.equal(result.title, candidates[winnerIndex]!.title);
  assert.equal(result.version, '2');
  const stored = await database.article.findUniqueOrThrow({ where: { id: article.id } });
  assert.equal(stored.title, result.title);
  assert.equal(stored.version, 2n);
  const links = await database.articleTag.findMany({ where: { articleId: article.id } });
  assert.deepEqual(
    links.map((link) => link.tagId),
    candidates[winnerIndex]!.tagIds,
  );
});

test('missing category or tags leave all article fields, version and existing links unchanged', async () => {
  const { cookie, article, update } = await editingContext();
  const before = await readSeedSnapshot();
  for (const fields of [{ categoryId: 99999 }, { tagIds: [99999] }]) {
    const failed = await updateArticle(cookie, article.slug, {
      ...update,
      title: 'Must roll back',
      ...fields,
    });
    assert.equal(failed.status, 400);
    await failed.arrayBuffer();
    assert.deepEqual(await readSeedSnapshot(), before);
  }
});

test('a replacement tag failure rolls back edited fields, incremented version and deleted links', async () => {
  const { cookie, article, update } = await editingContext();
  const before = await readSeedSnapshot();
  await database.$executeRaw`ALTER TABLE article_tags ADD CONSTRAINT editing_test_reject_tag CHECK (false) NOT VALID`;
  try {
    const response = await updateArticle(cookie, article.slug, {
      ...update,
      title: 'Must roll back',
      body: 'Not committed.',
    });
    assert.equal(response.status, 500);
    await response.arrayBuffer();
    assert.deepEqual(await readSeedSnapshot(), before);
  } finally {
    await database.$executeRaw`ALTER TABLE article_tags DROP CONSTRAINT editing_test_reject_tag`;
  }
  const retried = await updateArticle(cookie, article.slug, {
    ...update,
    title: 'Retry succeeded',
  });
  assert.equal(retried.status, 200);
  assert.equal((await retried.json()).article.version, '2');
});

test('editing increments bigint versions beyond JavaScript safe integers and rejects the PostgreSQL version limit safely', async () => {
  const { cookie, article, update } = await editingContext();
  await database.article.update({
    where: { id: article.id },
    data: { version: 9_007_199_254_740_993n },
  });
  const response = await updateArticle(cookie, article.slug, {
    ...update,
    version: '9007199254740993',
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).article.version, '9007199254740994');
  await database.article.update({
    where: { id: article.id },
    data: { version: 9_223_372_036_854_775_807n },
  });
  const before = await readSeedSnapshot();
  const exhausted = await updateArticle(cookie, article.slug, {
    ...update,
    version: '9223372036854775807',
  });
  assert.equal(exhausted.status, 409);
  assert.ok((await exhausted.json()).error.fields.version);
  assert.deepEqual(await readSeedSnapshot(), before);
});

function deleteArticle(cookie: string, slug: string, articleId: number, version: string) {
  return fetch(`${baseUrl}/api/articles/${slug}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', 'X-Hummingbird-Request': '1', Cookie: cookie },
    body: JSON.stringify({ articleId, version }),
  });
}

test('deletion cascades only the selected article comments and tag links, preserving shared data and other articles', async () => {
  const { cookie, article, user, input } = await editingContext();
  const otherResponse = await publishArticle(cookie, { ...input, slug: 'keep-this-article' });
  const other = (await otherResponse.json()).article;
  for (const articleId of [article.id, other.id]) {
    await database.comment.create({ data: { body: 'A comment.', articleId, authorId: user.id } });
  }
  const categories = await database.category.findMany();
  const tags = await database.tag.findMany();
  const users = await database.user.findMany();
  const response = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(response.status, 204);
  assert.equal(await response.text(), '');
  assert.equal(await database.article.findUnique({ where: { id: article.id } }), null);
  assert.equal(await database.comment.count({ where: { articleId: article.id } }), 0);
  assert.equal(await database.articleTag.count({ where: { articleId: article.id } }), 0);
  assert.equal(await database.comment.count({ where: { articleId: other.id } }), 1);
  assert.equal(await database.articleTag.count({ where: { articleId: other.id } }), 2);
  assert.deepEqual(await database.category.findMany(), categories);
  assert.deepEqual(await database.tag.findMany(), tags);
  assert.deepEqual(await database.user.findMany(), users);
  const detail = await fetch(`${baseUrl}/api/articles/${article.slug}`);
  assert.equal(detail.status, 404);
  await detail.arrayBuffer();
  const list = await fetch(`${baseUrl}/api/articles`);
  const result = await list.json();
  assert.equal(result.pagination.total, 1);
  assert.deepEqual(
    result.articles.map((item: { id: number }) => item.id),
    [other.id],
  );
  const repeated = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(repeated.status, 404);
  await repeated.arrayBuffer();
  assert.equal(await database.session.count(), 1);
});

test('other authors and missing articles cannot delete data and revoked sessions are rejected', async () => {
  const { cookie, article } = await editingContext();
  const registered = await registerAccount('other@example.test');
  assert.equal(registered.status, 201);
  await registered.arrayBuffer();
  const login = await signIn('other@example.test');
  assert.equal(login.status, 200);
  await login.arrayBuffer();
  const otherCookie = responseSession(login).cookie;
  const before = await readSeedSnapshot();
  for (const [session, slug, status] of [
    [otherCookie, article.slug, 403],
    [cookie, 'missing-article', 404],
  ] as const) {
    const response = await deleteArticle(session, slug, article.id, article.version);
    assert.equal(response.status, status);
    await response.arrayBuffer();
    assert.deepEqual(await readSeedSnapshot(), before);
  }
  const logout = await fetch(`${baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { 'X-Hummingbird-Request': '1', Cookie: cookie },
  });
  assert.equal(logout.status, 204);
  await logout.arrayBuffer();
  const denied = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(denied.status, 401);
  await denied.arrayBuffer();
  assert.deepEqual(await readSeedSnapshot(), before);
});

test('an expired session cannot delete an article or its child records', async () => {
  const { cookie, article } = await editingContext();
  await database.session.updateMany({
    data: {
      createdAt: new Date(Date.now() - 172800000),
      expiresAt: new Date(Date.now() - 86400000),
    },
  });
  const before = await readSeedSnapshot();
  const denied = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(denied.status, 401);
  assert.match(denied.headers.get('set-cookie')!, /^hummingbird_session=;/);
  await denied.arrayBuffer();
  assert.deepEqual(await readSeedSnapshot(), before);
});

test('a stale deletion leaves a newer article edit and its relationships intact', async () => {
  const { cookie, article, update, tags } = await editingContext();
  const saved = await updateArticle(cookie, article.slug, {
    ...update,
    title: 'Keep this newer edit',
    tagIds: [tags[0]!.id],
  });
  assert.equal(saved.status, 200);
  const current = (await saved.json()).article;
  const before = await readSeedSnapshot();
  const stale = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(stale.status, 409);
  assert.ok((await stale.json()).error.fields.version);
  assert.deepEqual(await readSeedSnapshot(), before);
  const confirmed = await deleteArticle(cookie, article.slug, current.id, current.version);
  assert.equal(confirmed.status, 204);
  await confirmed.arrayBuffer();
});

test('an old deletion confirmation cannot delete a replacement article at the same URL', async () => {
  const { cookie, article, input } = await editingContext();
  const removed = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(removed.status, 204);
  await removed.arrayBuffer();
  const created = await publishArticle(cookie, { ...input, title: 'Replacement article' });
  assert.equal(created.status, 201);
  const replacement = (await created.json()).article;
  assert.notEqual(replacement.id, article.id);
  assert.equal(replacement.version, article.version);
  const before = await readSeedSnapshot();
  const stale = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(stale.status, 409);
  await stale.arrayBuffer();
  assert.deepEqual(await readSeedSnapshot(), before);
});

test('two concurrent deletions have only one successful request and no orphaned children', async () => {
  const { cookie, article, user } = await editingContext();
  await database.comment.create({
    data: { body: 'Remove with the article.', articleId: article.id, authorId: user.id },
  });
  const responses = await Promise.all(
    [1, 2].map(() => deleteArticle(cookie, article.slug, article.id, article.version)),
  );
  assert.equal(responses.filter((response) => response.status === 204).length, 1);
  assert.ok(responses.every((response) => [204, 404, 409].includes(response.status)));
  for (const response of responses) await response.arrayBuffer();
  assert.equal(await database.article.count(), 0);
  assert.equal(await database.articleTag.count(), 0);
  assert.equal(await database.comment.count(), 0);
  assert.equal(await database.tag.count(), 2);
});

test('a concurrent edit and deletion of one version cannot both succeed', async () => {
  const { cookie, article, update, tags } = await editingContext();
  const [edited, deleted] = await Promise.all([
    updateArticle(cookie, article.slug, {
      ...update,
      title: 'Winning edit',
      tagIds: [tags[0]!.id],
    }),
    deleteArticle(cookie, article.slug, article.id, article.version),
  ]);
  if (edited.status === 200) {
    assert.equal(deleted.status, 409);
    const saved = (await edited.json()).article;
    assert.equal(saved.version, '2');
    assert.equal(await database.article.count(), 1);
    assert.deepEqual(
      (await database.articleTag.findMany()).map((link) => link.tagId),
      [tags[0]!.id],
    );
  } else {
    assert.equal(deleted.status, 204);
    assert.ok([404, 409].includes(edited.status));
    await edited.arrayBuffer();
    assert.equal(await database.article.count(), 0);
    assert.equal(await database.articleTag.count(), 0);
  }
  await deleted.arrayBuffer();
});

test('a failure during cascaded comment deletion rolls back the article and all its children', async () => {
  const { cookie, article, user } = await editingContext();
  await database.comment.create({
    data: { body: 'Keep after failure.', articleId: article.id, authorId: user.id },
  });
  const before = await readSeedSnapshot();
  await database.$executeRaw`CREATE FUNCTION deletion_test_reject_comment() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test cascade failure'; END; $$`;
  try {
    await database.$executeRaw`CREATE TRIGGER deletion_test_reject_comment BEFORE DELETE ON comments FOR EACH ROW EXECUTE FUNCTION deletion_test_reject_comment()`;
    try {
      const failed = await deleteArticle(cookie, article.slug, article.id, article.version);
      assert.equal(failed.status, 500);
      assert.deepEqual(await failed.json(), {
        error: { message: 'Unable to process the request. Try again later.' },
      });
      assert.deepEqual(await readSeedSnapshot(), before);
    } finally {
      await database.$executeRaw`DROP TRIGGER deletion_test_reject_comment ON comments`;
    }
  } finally {
    await database.$executeRaw`DROP FUNCTION deletion_test_reject_comment()`;
  }
  const retry = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(retry.status, 204);
  await retry.arrayBuffer();
});

test('deletion checks bigint versions exactly and allows deleting an article at the maximum version', async () => {
  const { cookie, article } = await editingContext();
  await database.article.update({
    where: { id: article.id },
    data: { version: 9223372036854775807n },
  });
  const stale = await deleteArticle(cookie, article.slug, article.id, '9223372036854775806');
  assert.equal(stale.status, 409);
  await stale.arrayBuffer();
  const deleted = await deleteArticle(cookie, article.slug, article.id, '9223372036854775807');
  assert.equal(deleted.status, 204);
  await deleted.arrayBuffer();
  assert.equal(await database.article.count(), 0);
});

function postArticleComment(cookie: string, slug: string, input: unknown) {
  return fetch(`${baseUrl}/api/articles/${slug}/comments`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hummingbird-Request': '1', Cookie: cookie },
    body: JSON.stringify(input),
  });
}

test('comment reads return an empty page for an article and a 404 for a missing article', async () => {
  const { article } = await editingContext();
  const response = await fetch(`${baseUrl}/api/articles/${article.slug}/comments`);
  assert.deepEqual(await response.json(), {
    articleId: article.id,
    comments: [],
    total: 0,
    nextCursor: null,
  });
  const missing = await fetch(`${baseUrl}/api/articles/missing/comments`);
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
});

test('a reader can post to another author article, storing its identity and updating public counts without changing article content', async () => {
  const { article } = await editingContext();
  const registered = await registerAccount('reader@example.test');
  const { user } = await registered.json();
  const login = await signIn('reader@example.test');
  await login.arrayBuffer();
  const input = {
    articleId: article.id,
    body: '  Thank you 🐦!\n\n<script>Plain text.</script>  ',
    requestId: randomUUID(),
  };
  const before = await database.article.findUniqueOrThrow({ where: { id: article.id } });
  const response = await postArticleComment(responseSession(login).cookie, article.slug, input);
  assert.equal(response.status, 201);
  const { comment } = await response.json();
  assert.equal(comment.body, input.body);
  assert.equal(comment.articleId, article.id);
  assert.deepEqual(comment.author, { id: user.id, username: user.username });
  assert.ok(Number.isFinite(Date.parse(comment.createdAt)));
  assert.deepEqual(Object.keys(comment).sort(), ['articleId', 'author', 'body', 'createdAt', 'id']);
  const stored = await database.comment.findUniqueOrThrow({ where: { id: comment.id } });
  assert.equal(stored.requestId, input.requestId);
  assert.equal(stored.authorId, user.id);
  assert.deepEqual(await database.article.findUniqueOrThrow({ where: { id: article.id } }), before);
  const detail = await fetch(`${baseUrl}/api/articles/${article.slug}`);
  assert.equal((await detail.json()).article.commentCount, 1);
  const list = await fetch(`${baseUrl}/api/articles/${article.slug}/comments`);
  assert.deepEqual(await list.json(), {
    articleId: article.id,
    comments: [comment],
    total: 1,
    nextCursor: null,
  });
});

test('comment retries return the original row, while changed bodies with that request ID are rejected', async () => {
  const { cookie, article } = await editingContext();
  const input = { articleId: article.id, body: 'Keep exactly this text.', requestId: randomUUID() };
  const created = await postArticleComment(cookie, article.slug, input);
  const original = await created.json();
  const retried = await postArticleComment(cookie, article.slug, input);
  assert.equal(retried.status, 200);
  assert.deepEqual(await retried.json(), original);
  const conflict = await postArticleComment(cookie, article.slug, {
    ...input,
    body: 'A changed comment.',
  });
  assert.equal(conflict.status, 409);
  await conflict.arrayBuffer();
  assert.equal(await database.comment.count(), 1);
  assert.equal((await database.comment.findFirstOrThrow()).body, input.body);
});

test('concurrent identical comment requests create exactly one row and return its same public identity', async () => {
  const { cookie, article } = await editingContext();
  const input = { articleId: article.id, body: 'One comment only.', requestId: randomUUID() };
  const responses = await Promise.all(
    [1, 2].map(() => postArticleComment(cookie, article.slug, input)),
  );
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 201]);
  assert.deepEqual(await responses[0]!.json(), await responses[1]!.json());
  assert.equal(await database.comment.count(), 1);
});

test('concurrent different comments with one request ID have one winner, and another account cannot replay it', async () => {
  const { cookie, article } = await editingContext();
  const input = { articleId: article.id, body: 'First candidate.', requestId: randomUUID() };
  const responses = await Promise.all([
    postArticleComment(cookie, article.slug, input),
    postArticleComment(cookie, article.slug, { ...input, body: 'Second candidate.' }),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  for (const response of responses) await response.arrayBuffer();
  const original = await database.comment.findFirstOrThrow();
  const account = await registerAccount('other@example.test');
  await account.arrayBuffer();
  const login = await signIn('other@example.test');
  await login.arrayBuffer();
  const denied = await postArticleComment(responseSession(login).cookie, article.slug, {
    ...input,
    body: original.body,
  });
  assert.equal(denied.status, 409);
  await denied.arrayBuffer();
  assert.equal(await database.comment.count(), 1);
  assert.deepEqual(await database.comment.findFirstOrThrow(), original);
});

test('comment pagination uses decreasing IDs without duplicates when newer comments arrive between pages', async () => {
  const { user, article } = await editingContext();
  await database.comment.createMany({
    data: Array.from({ length: 46 }, (_, index) => ({
      body: `Comment ${index + 1}.`,
      articleId: article.id,
      authorId: user.id,
      createdAt: new Date('2026-10-01T09:00:00Z'),
    })),
  });
  const first = await fetch(`${baseUrl}/api/articles/${article.slug}/comments`);
  const page = await first.json();
  assert.equal(page.comments.length, 20);
  assert.equal(page.total, 46);
  assert.equal(page.nextCursor, 27);
  assert.deepEqual(
    page.comments.map((comment: { id: number }) => comment.id),
    Array.from({ length: 20 }, (_, i) => 46 - i),
  );
  await database.comment.create({
    data: { body: 'A newer comment.', articleId: article.id, authorId: user.id },
  });
  const older = await fetch(
    `${baseUrl}/api/articles/${article.slug}/comments?before=${page.nextCursor}`,
  );
  const second = await older.json();
  assert.equal(second.total, 47);
  assert.equal(second.nextCursor, 7);
  const last = await fetch(
    `${baseUrl}/api/articles/${article.slug}/comments?before=${second.nextCursor}`,
  );
  const third = await last.json();
  assert.equal(third.comments.length, 6);
  assert.equal(third.nextCursor, null);
  assert.equal(
    new Set([...page.comments, ...second.comments, ...third.comments].map((comment) => comment.id))
      .size,
    46,
  );
});

test('invalid or oversized comments insert nothing, while Unicode boundaries preserve all text', async () => {
  const { cookie, article } = await editingContext();
  const input = { articleId: article.id, body: 'Valid.', requestId: randomUUID() };
  for (const fields of [
    { body: ' \t\n ' },
    { body: '🐦'.repeat(2001) },
    { body: '\ud800' },
    { authorId: 999 },
  ]) {
    const response = await postArticleComment(cookie, article.slug, { ...input, ...fields });
    assert.equal(response.status, 400);
    await response.arrayBuffer();
  }
  assert.equal(await database.comment.count(), 0);
  const boundary = await postArticleComment(cookie, article.slug, {
    ...input,
    body: '🐦'.repeat(2000),
  });
  assert.equal(boundary.status, 201);
  assert.equal((await boundary.json()).comment.body, '🐦'.repeat(2000));
});

test('missing articles and replaced URLs cannot receive comments intended for an old article', async () => {
  const { cookie, article, input } = await editingContext();
  const comment = {
    articleId: article.id,
    body: 'Keep the target identity.',
    requestId: randomUUID(),
  };
  const missing = await postArticleComment(cookie, 'missing', comment);
  assert.equal(missing.status, 404);
  await missing.arrayBuffer();
  const deleted = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(deleted.status, 204);
  await deleted.arrayBuffer();
  const replacement = await publishArticle(cookie, input);
  assert.equal(replacement.status, 201);
  await replacement.arrayBuffer();
  const stale = await postArticleComment(cookie, article.slug, comment);
  assert.equal(stale.status, 409);
  await stale.arrayBuffer();
  assert.equal(await database.comment.count(), 0);
});

test('expired and revoked sessions cannot post or replay comments', async () => {
  const { cookie, article } = await editingContext();
  const input = { articleId: article.id, body: 'An existing comment.', requestId: randomUUID() };
  const created = await postArticleComment(cookie, article.slug, input);
  await created.arrayBuffer();
  await database.session.updateMany({
    data: {
      createdAt: new Date(Date.now() - 172800000),
      expiresAt: new Date(Date.now() - 86400000),
    },
  });
  const expired = await postArticleComment(cookie, article.slug, input);
  assert.equal(expired.status, 401);
  await expired.arrayBuffer();
  await database.session.deleteMany();
  const revoked = await postArticleComment(cookie, article.slug, {
    ...input,
    requestId: randomUUID(),
  });
  assert.equal(revoked.status, 401);
  await revoked.arrayBuffer();
  assert.equal(await database.comment.count(), 1);
});

test('a failed comment insert rolls back without reserving the request ID and can be retried after repair', async () => {
  const { cookie, article } = await editingContext();
  const input = { articleId: article.id, body: 'Retry after repair.', requestId: randomUUID() };
  const before = await readSeedSnapshot();
  await database.$executeRaw`ALTER TABLE comments ADD CONSTRAINT comment_test_reject_insert CHECK (false) NOT VALID`;
  try {
    const failed = await postArticleComment(cookie, article.slug, input);
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), {
      error: { message: 'Unable to process the request. Try again later.' },
    });
    assert.deepEqual(await readSeedSnapshot(), before);
    assert.equal(await database.comment.count({ where: { requestId: input.requestId } }), 0);
  } finally {
    await database.$executeRaw`ALTER TABLE comments DROP CONSTRAINT comment_test_reject_insert`;
  }
  const retry = await postArticleComment(cookie, article.slug, input);
  assert.equal(retry.status, 201);
  await retry.arrayBuffer();
});

test('article deletion cascades posted comments and request IDs, so a later retry cannot recreate them', async () => {
  const { cookie, article } = await editingContext();
  const input = {
    articleId: article.id,
    body: 'Remove with the article.',
    requestId: randomUUID(),
  };
  const created = await postArticleComment(cookie, article.slug, input);
  assert.equal(created.status, 201);
  await created.arrayBuffer();
  const removed = await deleteArticle(cookie, article.slug, article.id, article.version);
  assert.equal(removed.status, 204);
  await removed.arrayBuffer();
  assert.equal(await database.comment.count(), 0);
  const retried = await postArticleComment(cookie, article.slug, input);
  assert.equal(retried.status, 404);
  await retried.arrayBuffer();
  assert.equal(await database.comment.count(), 0);
});
