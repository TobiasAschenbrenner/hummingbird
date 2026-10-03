import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { createArticleControllers } from '../controllers/article.controller.ts';
import { requireApiRequest } from '../middleware/api-request.ts';
import { articleJsonBody } from '../middleware/json-body.ts';
import { createRequireSession } from '../middleware/require-session.ts';
import type { ArticleQueries } from '../models/article.model.ts';
import type { AuthenticationService } from '../models/session.model.ts';

interface ArticleOptions {
  articles: ArticleQueries;
  authentication: AuthenticationService;
  secureCookies?: boolean;
}

export function createArticleRouter({
  articles,
  authentication,
  secureCookies = false,
}: ArticleOptions) {
  const router = Router();
  const controllers = createArticleControllers(articles);
  const writeLimit = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many article changes. Try again later.' } },
  });
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', controllers.list);
  router.get('/:slug', controllers.detail);
  router.post(
    '/',
    writeLimit,
    requireApiRequest,
    createRequireSession(authentication, secureCookies),
    articleJsonBody,
    controllers.create,
  );
  router.put(
    '/:slug',
    writeLimit,
    requireApiRequest,
    createRequireSession(authentication, secureCookies),
    articleJsonBody,
    controllers.update,
  );
  router.delete(
    '/:slug',
    writeLimit,
    requireApiRequest,
    createRequireSession(authentication, secureCookies),
    articleJsonBody,
    controllers.delete,
  );
  return router;
}
