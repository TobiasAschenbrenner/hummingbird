import express from 'express';

import { healthRouter } from './routes/health.routes.ts';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use('/api', healthRouter);

  app.use((_request, response) => {
    response.status(404).json({ error: { message: 'Route not found.' } });
  });

  return app;
}
