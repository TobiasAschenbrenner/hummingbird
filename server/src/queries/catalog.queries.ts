import type { PrismaClient } from '../generated/prisma/client.ts';
import type { CatalogQueries } from '../models/catalog.model.ts';

export function createCatalogQueries(database: PrismaClient): CatalogQueries {
  const select = { id: true, slug: true, name: true };
  return {
    listCategories() {
      return database.category.findMany({ select, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    },
    listTags() {
      return database.tag.findMany({ select, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
    },
  };
}
