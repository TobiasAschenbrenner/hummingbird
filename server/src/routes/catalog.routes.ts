import { Router } from 'express';

import { createCatalogControllers } from '../controllers/catalog.controller.ts';
import type { CatalogQueries } from '../models/catalog.model.ts';

export function createCatalogRouter(catalogs: CatalogQueries) {
  const router = Router();
  const controllers = createCatalogControllers(catalogs);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/categories', controllers.categories);
  router.get('/tags', controllers.tags);
  return router;
}
