import { Prisma, type PrismaClient } from '../generated/prisma/client.ts';
import { HttpError } from '../errors/http-error.ts';
import { readArticleBySlug, readArticlePage } from './article-read.queries.ts';
import type { ArticleDetail, ArticleQueries, ArticleSummary } from '../models/article.model.ts';

const summarySelect = {
  id: true,
  slug: true,
  title: true,
  description: true,
  imageFilename: true,
  coverImage: { select: { url: true, width: true, height: true } },
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

function readPostgresConstraint(error: Prisma.PrismaClientKnownRequestError) {
  const adapterError = error.meta?.driverAdapterError;
  const cause = adapterError instanceof Error ? adapterError.cause : undefined;
  if (!cause || typeof cause !== 'object') return {};
  const code = 'originalCode' in cause ? cause.originalCode : undefined;
  const constraint = 'constraint' in cause ? cause.constraint : undefined;
  const index =
    constraint && typeof constraint === 'object' && 'index' in constraint
      ? constraint.index
      : undefined;
  return { code, index };
}

type SummaryRecord = Prisma.ArticleGetPayload<{ select: typeof summarySelect }>;

function toSummary(article: SummaryRecord): ArticleSummary {
  return {
    id: article.id,
    slug: article.slug,
    title: article.title,
    description: article.description,
    imageFilename: article.imageFilename,
    coverImage: article.coverImage
      ? {
          url: article.coverImage.url!,
          width: article.coverImage.width!,
          height: article.coverImage.height!,
        }
      : null,
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
    const { code, index } = readPostgresConstraint(error);
    if (
      (error.code === 'P2002' || (error.code === 'P2010' && code === '23505')) &&
      index === 'articles_slug_key'
    ) {
      throw new HttpError(409, 'An article with this slug already exists.', {
        slug: 'Choose another article slug.',
      });
    }
    if (error.code === 'P2003' || (error.code === 'P2010' && code === '23503')) {
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
          const [article] = await transaction.$queryRaw<{ id: number }[]>`
            INSERT INTO public.articles (slug, title, description, body, author_id, category_id)
            VALUES (${input.slug}, ${input.title}, ${input.description}, ${input.body},
              ${input.authorId}, ${input.categoryId})
            RETURNING id
          `;
          if (tagIds.length) {
            await transaction.$executeRaw(Prisma.sql`
              INSERT INTO public.article_tags (article_id, tag_id)
              VALUES ${Prisma.join(tagIds.map((tagId) => Prisma.sql`(${article!.id}, ${tagId})`))}
            `);
          }
          const saved = await transaction.article.findUniqueOrThrow({
            where: { id: article!.id },
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
    listArticles(input) {
      return readArticlePage(database, input);
    },
    findArticleBySlug(slug) {
      return readArticleBySlug(database, slug);
    },
  };
}

export { detailSelect, toDetail };
