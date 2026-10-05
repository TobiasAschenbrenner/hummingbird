import { HttpError } from '../errors/http-error.ts';
import type { ArticleListInput } from '../models/article.model.ts';
import { parseArticleSlug } from './article.validator.ts';
import { isWellFormed } from './credentials.validator.ts';

function readPositiveInteger(value: unknown, fallback: number, maximum: number, field: string) {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    value.length > String(maximum).length ||
    !/^[1-9][0-9]*$/.test(value) ||
    Number(value) > maximum
  ) {
    throw new HttpError(400, `Use a whole number from 1 to ${maximum} for ${field}.`);
  }
  return Number(value);
}

function readSearch(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (
    typeof value !== 'string' ||
    value.length > 200 ||
    !isWellFormed(value) ||
    /\p{Cc}/u.test(value) ||
    [...value.trim()].length > 100
  ) {
    throw new HttpError(400, 'Use up to 100 search characters without control characters.');
  }
  return value.trim() || undefined;
}

export function parseArticleList(query: Record<string, unknown>): ArticleListInput {
  if (
    Object.keys(query).some(
      (field) => !['page', 'pageSize', 'q', 'category', 'tag'].includes(field),
    )
  ) {
    throw new HttpError(
      400,
      'Only page, pageSize, q, category and tag query parameters are accepted.',
    );
  }
  const q = readSearch(query.q);
  return {
    page: readPositiveInteger(query.page, 1, 10_000, 'page'),
    pageSize: readPositiveInteger(query.pageSize, 12, 50, 'pageSize'),
    ...(q ? { q } : {}),
    ...(query.category !== undefined ? { category: parseArticleSlug(query.category) } : {}),
    ...(query.tag !== undefined ? { tag: parseArticleSlug(query.tag) } : {}),
  };
}
