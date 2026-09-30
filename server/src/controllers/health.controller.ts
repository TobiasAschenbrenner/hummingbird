import type { RequestHandler } from 'express';

export const getHealth: RequestHandler = (_request, response) => {
  response.set('Cache-Control', 'no-store').json({ status: 'ok' });
};
