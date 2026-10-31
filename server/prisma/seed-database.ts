import type { PrismaClient } from '../src/generated/prisma/client.ts';
import {
  DEFAULT_CATEGORIES,
  DEMO_ARTICLES,
  DEMO_PASSWORD_DISABLED,
  DEMO_TAGS,
  DEMO_USERS,
} from './seed-data.ts';

export async function seedDatabase(database: PrismaClient, options = { demo: false }) {
  return database.$transaction(async (transaction) => {
    const categories = await transaction.category.createMany({
      data: DEFAULT_CATEGORIES,
      skipDuplicates: true,
    });
    const added = {
      categories: categories.count,
      users: 0,
      tags: 0,
      articles: 0,
      articleTags: 0,
      comments: 0,
    };

    if (!options.demo) {
      return added;
    }

    const users = await transaction.user.createMany({ data: DEMO_USERS, skipDuplicates: true });
    added.users = users.count;
    const demoUsers = await transaction.user.findMany({
      where: { email: { in: DEMO_USERS.map((user) => user.email) } },
      select: { id: true, email: true, passwordHash: true },
    });
    if (demoUsers.some((user) => user.passwordHash !== DEMO_PASSWORD_DISABLED)) {
      throw new Error(
        'A demo email belongs to an existing login account. No seed changes were saved.',
      );
    }

    const tags = await transaction.tag.createMany({ data: DEMO_TAGS, skipDuplicates: true });
    added.tags = tags.count;
    const categoryIds = new Map(
      (
        await transaction.category.findMany({
          where: { slug: { in: DEFAULT_CATEGORIES.map((category) => category.slug) } },
          select: { id: true, slug: true },
        })
      ).map((category) => [category.slug, category.id]),
    );
    const tagIds = new Map(
      (
        await transaction.tag.findMany({
          where: { slug: { in: DEMO_TAGS.map((tag) => tag.slug) } },
          select: { id: true, slug: true },
        })
      ).map((tag) => [tag.slug, tag.id]),
    );
    const userIds = new Map(demoUsers.map((user) => [user.email, user.id]));

    for (const sample of DEMO_ARTICLES) {
      const [article] = await transaction.article.createManyAndReturn({
        data: {
          slug: sample.slug,
          title: sample.title,
          description: sample.description,
          body: sample.body,
          createdAt: sample.createdAt,
          authorId: requireId(userIds, sample.authorEmail),
          categoryId: requireId(categoryIds, sample.categorySlug),
        },
        skipDuplicates: true,
        select: { id: true },
      });
      if (!article) {
        continue;
      }

      added.articles += 1;
      const links = await transaction.articleTag.createMany({
        data: sample.tagSlugs.map((slug) => ({
          articleId: article.id,
          tagId: requireId(tagIds, slug),
        })),
      });
      added.articleTags += links.count;
      if (sample.comments.length) {
        const comments = await transaction.comment.createMany({
          data: sample.comments.map((comment) => ({
            body: comment.body,
            createdAt: comment.createdAt,
            articleId: article.id,
            authorId: requireId(userIds, comment.authorEmail),
          })),
        });
        added.comments += comments.count;
      }
    }

    return added;
  });
}

function requireId(ids: Map<string, number>, key: string): number {
  const id = ids.get(key);
  if (id === undefined) {
    throw new Error('A seed relationship refers to a missing catalog entry.');
  }
  return id;
}
