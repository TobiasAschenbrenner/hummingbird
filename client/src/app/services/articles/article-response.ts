import {
  ARTICLE_PAGE_SIZE,
  ArticleDetail,
  ArticlePage,
  ArticleSummary,
} from '../../models/article.model';
import { isArticleSlug } from '../../validators/article.validator';
import { readCatalogEntry } from '../catalogs/catalog-response';

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalidResponse();
  return value as RecordValue;
}

function invalidResponse(): never {
  throw new Error('Unexpected article API response.');
}

function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) invalidResponse();
  return value;
}

function integer(value: unknown, minimum = 1): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum)
    invalidResponse();
  return value;
}

function slug(value: unknown): string {
  if (!isArticleSlug(value)) invalidResponse();
  return value;
}

function summary(value: unknown): ArticleSummary {
  const data = record(value);
  const author = record(data['author']);
  const createdAt = text(data['createdAt']);
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt))
  )
    invalidResponse();
  const imageFilename = data['imageFilename'];
  if (imageFilename !== null && typeof imageFilename !== 'string') invalidResponse();
  if (!Array.isArray(data['tags'])) invalidResponse();
  const tags = data['tags'].map(readCatalogEntry);
  if (new Set(tags.map((tag) => tag.id)).size !== tags.length) invalidResponse();
  return {
    id: integer(data['id']),
    slug: slug(data['slug']),
    title: text(data['title']),
    description: text(data['description']),
    imageFilename,
    createdAt,
    author: { id: integer(author['id']), username: text(author['username']) },
    category: readCatalogEntry(data['category']),
    tags,
    commentCount: integer(data['commentCount'], 0),
  };
}

export function readArticlePageResponse(value: unknown, page: number): ArticlePage {
  const data = record(value);
  const pagination = record(data['pagination']);
  const total = integer(pagination['total'], 0);
  const totalPages = integer(pagination['totalPages'], 0);
  if (
    pagination['page'] !== page ||
    pagination['pageSize'] !== ARTICLE_PAGE_SIZE ||
    totalPages !== Math.ceil(total / ARTICLE_PAGE_SIZE) ||
    !Array.isArray(data['articles'])
  )
    invalidResponse();
  const articles = data['articles'].map(summary);
  const expectedLength = Math.min(
    ARTICLE_PAGE_SIZE,
    Math.max(0, total - (page - 1) * ARTICLE_PAGE_SIZE),
  );
  if (
    articles.length !== expectedLength ||
    new Set(articles.map((article) => article.id)).size !== articles.length
  )
    invalidResponse();
  return { articles, pagination: { page, pageSize: ARTICLE_PAGE_SIZE, total, totalPages } };
}

export function readArticleDetailResponse(value: unknown, requestedSlug: string): ArticleDetail {
  const data = record(record(value)['article']);
  const article = summary(data);
  const version = text(data['version']);
  if (article.slug !== requestedSlug || !/^[1-9][0-9]*$/.test(version)) invalidResponse();
  return { ...article, body: text(data['body']), version };
}
