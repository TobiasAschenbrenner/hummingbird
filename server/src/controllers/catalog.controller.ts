import type { Request, Response } from 'express';

import type { CatalogQueries } from '../models/catalog.model.ts';

export function createCatalogControllers(catalogs: CatalogQueries) {
  return {
    async categories(_request: Request, response: Response) {
      response.json({ categories: await catalogs.listCategories() });
    },
    async tags(_request: Request, response: Response) {
      response.json({ tags: await catalogs.listTags() });
    },
  };
}
