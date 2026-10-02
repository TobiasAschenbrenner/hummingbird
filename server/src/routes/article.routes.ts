import { Router } from 'express';

import { createArticleControllers } from '../controllers/article.controller.ts';
import type { ArticleQueries } from '../models/article.model.ts';

export function createArticleRouter(articles: ArticleQueries) {
  const router = Router();
  const controllers = createArticleControllers(articles);
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', controllers.list);
  router.get('/:slug', controllers.detail);
  return router;
}
