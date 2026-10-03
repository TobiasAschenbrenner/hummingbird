import express from 'express';

import { errorHandler } from './middleware/error-handler.ts';
import type { ArticleQueries } from './models/article.model.ts';
import type { CommentQueries } from './models/comment.model.ts';
import { createCommentRouter } from './routes/comment.routes.ts';
import type { CatalogQueries } from './models/catalog.model.ts';
import { createCatalogRouter } from './routes/catalog.routes.ts';
import { createArticleRouter } from './routes/article.routes.ts';
import { createAuthRouter, type AuthOptions } from './routes/auth.routes.ts';
import { healthRouter } from './routes/health.routes.ts';

export interface AppOptions extends AuthOptions {
  articles: ArticleQueries;
  comments: CommentQueries;
  catalogs: CatalogQueries;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', healthRouter);
  app.use('/api/auth', createAuthRouter(options));
  app.use('/api/articles/:slug/comments', createCommentRouter(options));
  app.use('/api/articles', createArticleRouter(options));
  app.use('/api', createCatalogRouter(options.catalogs));

  app.use((_request, response) => {
    response.status(404).json({ error: { message: 'Route not found.' } });
  });
  app.use(errorHandler);

  return app;
}
