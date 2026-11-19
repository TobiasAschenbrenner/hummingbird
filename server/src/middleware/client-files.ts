import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import express, { Router } from 'express';

export function createClientRouter(directory: string) {
  const clientDirectory = resolve(directory);
  const indexFile = resolve(clientDirectory, 'index.html');
  if (!existsSync(indexFile)) {
    throw new Error('Build the Angular client before starting the production server.');
  }

  const router = Router();
  router.use(express.static(clientDirectory, { index: false, redirect: false }));
  router.get('/{*path}', (request, response, next) => {
    if (
      request.path.split('/').some((part) => part.startsWith('.')) ||
      extname(request.path) ||
      !request.accepts('html')
    ) {
      next();
      return;
    }
    response.set('Cache-Control', 'no-cache').sendFile(indexFile);
  });
  return router;
}
