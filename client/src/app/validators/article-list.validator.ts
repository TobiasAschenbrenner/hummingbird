import { ParamMap } from '@angular/router';

import { ArticleFilters, ArticleListQuery } from '../models/article.model';
import { isArticleSlug, readArticlePage } from './article.validator';

export function readArticleFilters(input: ArticleFilters): ArticleFilters | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const q = input.q === undefined ? '' : input.q;
  if (
    typeof q !== 'string' ||
    q.length > 200 ||
    [...q.trim()].length > 100 ||
    /[\uD800-\uDFFF]/u.test(q) ||
    /\p{Cc}/u.test(q)
  )
    return null;
  if (input.category !== undefined && !isArticleSlug(input.category)) return null;
  if (input.tag !== undefined && !isArticleSlug(input.tag)) return null;
  return {
    ...(q.trim() ? { q: q.trim() } : {}),
    ...(input.category !== undefined ? { category: input.category } : {}),
    ...(input.tag !== undefined ? { tag: input.tag } : {}),
  };
}

export function readArticleListQuery(params: ParamMap): ArticleListQuery | null {
  if (params.keys.some((key) => !['page', 'q', 'category', 'tag'].includes(key))) return null;
  if (['q', 'category', 'tag'].some((key) => params.getAll(key).length > 1)) return null;
  const page = readArticlePage(params.getAll('page'));
  const filters = readArticleFilters({
    q: params.get('q') ?? undefined,
    category: params.get('category') ?? undefined,
    tag: params.get('tag') ?? undefined,
  });
  return page !== null && filters ? { page, ...filters } : null;
}

export function articleListParams(
  query: ArticleListQuery,
  page = query.page,
): Record<string, string | number> {
  return {
    ...(page > 1 ? { page } : {}),
    ...(query.q ? { q: query.q } : {}),
    ...(query.category ? { category: query.category } : {}),
    ...(query.tag ? { tag: query.tag } : {}),
  };
}
