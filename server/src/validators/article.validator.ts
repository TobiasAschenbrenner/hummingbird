import { HttpError } from '../errors/http-error.ts';
import type { ArticlePageInput } from '../models/article.model.ts';

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

export function parseArticlePage(query: Record<string, unknown>): ArticlePageInput {
  if (Object.keys(query).some((field) => !['page', 'pageSize'].includes(field))) {
    throw new HttpError(400, 'Only page and pageSize query parameters are accepted.');
  }
  return {
    page: readPositiveInteger(query.page, 1, 10_000, 'page'),
    pageSize: readPositiveInteger(query.pageSize, 12, 50, 'pageSize'),
  };
}

export function parseArticleSlug(value: unknown): string {
  if (typeof value !== 'string' || value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new HttpError(400, 'Use an article slug of 1–80 lowercase letters, digits and hyphens.');
  }
  return value;
}
