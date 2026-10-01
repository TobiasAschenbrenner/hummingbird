import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { after, before, beforeEach, test } from 'node:test';

import { createDatabaseClient } from '../../src/database/client.ts';
import { readTestDatabaseUrl } from '../helpers/database.ts';

let database: ReturnType<typeof createDatabaseClient>;
let databaseVerified = false;

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

async function clearDatabase() {
  assert.ok(databaseVerified, 'Refusing to clear an unverified database.');
  await database.$executeRaw`TRUNCATE TABLE public.comments, public.article_tags,
    public.articles, public.tags, public.categories, public.users RESTART IDENTITY CASCADE`;
}

beforeEach(clearDatabase);
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
