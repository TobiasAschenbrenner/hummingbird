import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { Server } from 'node:http';
import { verify } from 'argon2';
import { after, before, beforeEach, test } from 'node:test';

import { createApp } from '../../src/app.ts';
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
  server = createApp({
    registerUser: createRegistrationService(createUserQueries(database)),
  }).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

async function clearDatabase() {
  assert.ok(databaseVerified, 'Refusing to clear an unverified database.');
  await database.$executeRaw`TRUNCATE TABLE public.comments, public.article_tags,
    public.articles, public.tags, public.categories, public.users RESTART IDENTITY CASCADE`;
}

beforeEach(clearDatabase);
after(async () => {
  if (server?.listening) {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => (error ? reject(error) : resolve()));
    });
  }
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
