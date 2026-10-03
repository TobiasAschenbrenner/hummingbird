import { MAX_ARTICLE_PAGE } from '../models/article.model';

export function readArticlePage(values: string[]): number | null {
  if (!values.length) return 1;
  const [value] = values;
  if (values.length !== 1 || value === undefined) return null;
  return /^[1-9][0-9]{0,4}$/.test(value) && Number(value) <= MAX_ARTICLE_PAGE
    ? Number(value)
    : null;
}

export function isArticleSlug(value: unknown): value is string {
  return (
    typeof value === 'string' && value.length <= 80 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

export function slugFromTitle(title: string): string {
  return title
    .normalize('NFKD')
    .toLowerCase()
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
    .replace(/-$/, '');
}
