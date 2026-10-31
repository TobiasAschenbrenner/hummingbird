import { CatalogEntry } from '../../models/catalog.model';
import { isArticleSlug } from '../../validators/article.validator';

export function readCatalogEntry(value: unknown): CatalogEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const data = value as Record<string, unknown>;
  const id = data['id'];
  const name = data['name'];
  const slug = data['slug'];
  if (
    typeof id !== 'number' ||
    !Number.isInteger(id) ||
    id <= 0 ||
    id > 2_147_483_647 ||
    typeof name !== 'string' ||
    !name.trim() ||
    !isArticleSlug(slug)
  )
    invalid();
  return { id, name, slug };
}

export function readCatalogResponse(value: unknown, key: 'categories' | 'tags'): CatalogEntry[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  const entries = (value as Record<string, unknown>)[key];
  if (!Array.isArray(entries)) invalid();
  const result = entries.map(readCatalogEntry);
  if (
    new Set(result.map((item) => item.id)).size !== result.length ||
    new Set(result.map((item) => item.slug)).size !== result.length
  )
    invalid();
  return result;
}

function invalid(): never {
  throw new Error('Unexpected catalog API response.');
}
