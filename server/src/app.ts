import express from 'express';

import { errorHandler } from './middleware/error-handler.ts';
import { createAuthRouter, type AuthOptions } from './routes/auth.routes.ts';
import { healthRouter } from './routes/health.routes.ts';

export function createApp(options: AuthOptions) {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', healthRouter);
  app.use('/api/auth', createAuthRouter(options));

  app.use((_request, response) => {
    response.status(404).json({ error: { message: 'Route not found.' } });
  });
  app.use(errorHandler);

  return app;
}
