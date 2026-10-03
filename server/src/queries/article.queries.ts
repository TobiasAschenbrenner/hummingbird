import { Prisma, type PrismaClient } from '../generated/prisma/client.ts';
import { HttpError } from '../errors/http-error.ts';
import type { ArticleDetail, ArticleQueries, ArticleSummary } from '../models/article.model.ts';

const summarySelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  imageFilename: true,
  createdAt: true,
  author: { select: { id: true, username: true } },
  category: { select: { id: true, slug: true, name: true } },
  tags: {
    select: { tag: { select: { id: true, slug: true, name: true } } },
    orderBy: [{ tag: { name: 'asc' } }, { tagId: 'asc' }],
  },
  _count: { select: { comments: true } },
} satisfies Prisma.ArticleSelect;

const detailSelect = { ...summarySelect, body: true, version: true } satisfies Prisma.ArticleSelect;

type DetailRecord = Prisma.ArticleGetPayload<{ select: typeof detailSelect }>;

function toDetail(article: DetailRecord): ArticleDetail {
  return { ...toSummary(article), body: article.body, version: article.version.toString() };
}

function isSlugConstraint(error: Prisma.PrismaClientKnownRequestError): boolean {
  const adapterError = error.meta?.driverAdapterError;
  const cause = adapterError instanceof Error ? adapterError.cause : undefined;
  if (!cause || typeof cause !== 'object' || !('constraint' in cause)) return false;
  const constraint = cause.constraint;
  return (
    !!constraint &&
    typeof constraint === 'object' &&
    'index' in constraint &&
    constraint.index === 'articles_slug_key'
  );
}

type SummaryRecord = Prisma.ArticleGetPayload<{ select: typeof summarySelect }>;

function toSummary(article: SummaryRecord): ArticleSummary {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    description: article.description,
    imageFilename: article.imageFilename,
    createdAt: article.createdAt.toISOString(),
    author: article.author,
    category: article.category,
    tags: article.tags.map(({ tag }) => tag),
    commentCount: article._count.comments,
  };
}

async function validateRelationships(
  transaction: Prisma.TransactionClient,
  categoryId: number,
  tagIds: number[],
): Promise<void> {
  const category = await transaction.category.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  const tagCount = await transaction.tag.count({ where: { id: { in: tagIds } } });
  const fields: Record<string, string> = {};
  if (!category) fields.categoryId = 'Select an existing category.';
  if (tagCount !== tagIds.length) fields.tagIds = 'Select existing tags.';
  if (Object.keys(fields).length)
    throw new HttpError(400, 'Please check your article details.', fields);
}

function throwWriteError(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002' && isSlugConstraint(error)) {
      throw new HttpError(409, 'An article with this slug already exists.', {
        slug: 'Choose another article slug.',
      });
    }
    if (error.code === 'P2003') {
      throw new HttpError(
        409,
        'Selected article relationships changed. Reload the options and try again.',
      );
    }
  }
  throw error;
}

function staleEdit(): never {
  throw new HttpError(409, 'The article changed. Load its latest version before saving again.', {
    version: 'Load the latest article before saving again.',
  });
}

export function createArticleQueries(database: PrismaClient): ArticleQueries {
  return {
    async createArticle({ tagIds, ...input }) {
      try {
        return await database.$transaction(async (transaction) => {
          await validateRelationships(transaction, input.categoryId, tagIds);
          const article = await transaction.article.create({ data: input, select: { id: true } });
          if (tagIds.length) {
            await transaction.articleTag.createMany({
              data: tagIds.map((tagId) => ({ articleId: article.id, tagId })),
            });
          }
          const saved = await transaction.article.findUniqueOrThrow({
            where: { id: article.id },
            select: detailSelect,
          });
          return toDetail(saved);
        });
      } catch (error) {
        throwWriteError(error);
      }
    },
    async updateArticle({ slug, authorId, version, tagIds, ...content }) {
      try {
        return await database.$transaction(async (transaction) => {
          const article = await transaction.article.findUnique({
            where: { slug },
            select: { id: true, authorId: true, version: true },
          });
          if (!article) throw new HttpError(404, 'Article not found.');
          if (article.authorId !== authorId)
            throw new HttpError(403, 'You can only edit your own articles.');
          const expectedVersion = BigInt(version);
          if (article.version !== expectedVersion) staleEdit();
          if (expectedVersion === 9_223_372_036_854_775_807n) {
            throw new HttpError(409, 'This article has reached its version limit.', {
              version: 'This article cannot be edited further.',
            });
          }
          await validateRelationships(transaction, content.categoryId, tagIds);
          // The conditional UPDATE locks the row; only one save of this version can win.
          const updated = await transaction.article.updateMany({
            where: { id: article.id, authorId, version: expectedVersion },
            data: { ...content, version: { increment: 1 } },
          });
          if (updated.count !== 1) staleEdit();
          await transaction.articleTag.deleteMany({ where: { articleId: article.id } });
          if (tagIds.length)
            await transaction.articleTag.createMany({
              data: tagIds.map((tagId) => ({ articleId: article.id, tagId })),
            });
          const saved = await transaction.article.findUniqueOrThrow({
            where: { id: article.id },
            select: detailSelect,
          });
          return toDetail(saved);
        });
      } catch (error) {
        throwWriteError(error);
      }
    },
    async deleteArticle({ slug, authorId, articleId, version }) {
      await database.$transaction(async (transaction) => {
        const article = await transaction.article.findUnique({
          where: { slug },
          select: { id: true, authorId: true, version: true },
        });
        if (!article) throw new HttpError(404, 'Article not found.');
        if (article.authorId !== authorId)
          throw new HttpError(403, 'You can only delete your own articles.');
        const expectedVersion = BigInt(version);
        const conflict = () =>
          new HttpError(409, 'The article changed. Reload and review it before deleting.', {
            version: 'Load the latest article before deleting.',
          });
        if (article.id !== articleId || article.version !== expectedVersion) throw conflict();
        // The conditional DELETE locks the parent row; foreign keys cascade its children.
        const deleted = await transaction.article.deleteMany({
          where: { id: articleId, slug, authorId, version: expectedVersion },
        });
        if (deleted.count !== 1) throw conflict();
      });
    },
    async listArticles({ page, pageSize }) {
      // Keep the page and its total on the same snapshot while other users publish.
      const { articles, total } = await database.$transaction(
        async (transaction) => {
          const articles = await transaction.article.findMany({
            select: summarySelect,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          });
          const total = await transaction.article.count();
          return { articles, total };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
      return {
        articles: articles.map(toSummary),
        pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
      };
    },
    async findArticleBySlug(slug) {
      const article = await database.article.findUnique({
        where: { slug },
        select: detailSelect,
      });
      if (!article) return null;
      return toDetail(article);
    },
  };
}
