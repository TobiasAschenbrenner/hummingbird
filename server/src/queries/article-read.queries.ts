import { Prisma } from '../generated/prisma/client.ts';
import type { ArticleDetail, ArticleSummary } from '../models/article.model.ts';

type ArticleReadDatabase = Pick<Prisma.TransactionClient, '$queryRaw'>;
type ArticleSummaryRow = Omit<ArticleSummary, 'createdAt' | 'commentCount'> & {
  createdAt: Date;
  commentCount: bigint;
};
type ArticleDetailRow = ArticleSummaryRow & { body: string; version: bigint };

// Aggregate each child relation first so joining tags cannot multiply comment counts.
const articleAggregates = Prisma.sql`
  article_tag_groups AS (
    SELECT links.article_id,
      jsonb_agg(
        jsonb_build_object('id', tag.id, 'slug', tag.slug, 'name', tag.name)
        ORDER BY tag.name, tag.id
      ) AS tags
    FROM public.article_tags AS links
    JOIN selected_articles AS selected ON selected.id = links.article_id
    JOIN public.tags AS tag ON tag.id = links.tag_id
    GROUP BY links.article_id
  ),
  article_comment_counts AS (
    SELECT comment.article_id, COUNT(*) AS comment_count
    FROM public.comments AS comment
    JOIN selected_articles AS selected ON selected.id = comment.article_id
    GROUP BY comment.article_id
  )
`;

const articleColumns = Prisma.sql`
  article.id, article.slug, article.title, article.description,
  article.image_filename AS "imageFilename", article.created_at AS "createdAt",
  jsonb_build_object('id', author.id, 'username', author.username) AS author,
  jsonb_build_object('id', category.id, 'slug', category.slug, 'name', category.name) AS category,
  CASE WHEN cover.article_id IS NULL THEN NULL
    ELSE jsonb_build_object('url', cover.url, 'width', cover.width, 'height', cover.height)
  END AS "coverImage",
  COALESCE(article_tag_groups.tags, '[]'::jsonb) AS tags,
  COALESCE(article_comment_counts.comment_count, 0) AS "commentCount"
`;

const articleJoins = Prisma.sql`
  JOIN public.users AS author ON author.id = article.author_id
  JOIN public.categories AS category ON category.id = article.category_id
  LEFT JOIN public.cover_images AS cover ON cover.article_id = article.id
  LEFT JOIN article_tag_groups ON article_tag_groups.article_id = article.id
  LEFT JOIN article_comment_counts ON article_comment_counts.article_id = article.id
`;

function toSummary(row: ArticleSummaryRow): ArticleSummary {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    commentCount: Number(row.commentCount),
  };
}

export async function readArticleBySlug(
  database: ArticleReadDatabase,
  slug: string,
): Promise<ArticleDetail | null> {
  const [article] = await database.$queryRaw<ArticleDetailRow[]>(Prisma.sql`
    WITH selected_articles AS (
      SELECT * FROM public.articles WHERE slug = ${slug}
    ),
    ${articleAggregates}
    SELECT ${articleColumns}, article.body, article.version
    FROM selected_articles AS article
    ${articleJoins}
  `);
  return article
    ? { ...toSummary(article), body: article.body, version: article.version.toString() }
    : null;
}
