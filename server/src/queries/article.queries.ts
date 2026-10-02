import { Prisma, type PrismaClient } from '../generated/prisma/client.ts';
import type { ArticleQueries, ArticleSummary } from '../models/article.model.ts';

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

export function createArticleQueries(database: PrismaClient): ArticleQueries {
  return {
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
        select: { ...summarySelect, body: true, version: true },
      });
      if (!article) return null;
      return { ...toSummary(article), body: article.body, version: article.version.toString() };
    },
  };
}
