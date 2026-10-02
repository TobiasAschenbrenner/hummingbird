import express from 'express';

import { errorHandler } from './middleware/error-handler.ts';
import type { ArticleQueries } from './models/article.model.ts';
import { createArticleRouter } from './routes/article.routes.ts';
import { createAuthRouter, type AuthOptions } from './routes/auth.routes.ts';
import { healthRouter } from './routes/health.routes.ts';

export interface AppOptions extends AuthOptions {
  articles: ArticleQueries;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', healthRouter);
  app.use('/api/auth', createAuthRouter(options));
  app.use('/api/articles', createArticleRouter(options.articles));

  app.use((_request, response) => {
    response.status(404).json({ error: { message: 'Route not found.' } });
  });
  app.use(errorHandler);

  return app;
}
