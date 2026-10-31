import type { RequestHandler } from 'express';

import { HttpError } from '../errors/http-error.ts';

export const requireApiRequest: RequestHandler = (request, _response, next) => {
  if (
    request.get('X-Hummingbird-Request') !== '1' ||
    request.get('Sec-Fetch-Site') === 'cross-site'
  ) {
    throw new HttpError(403, 'Send this request from Hummingbird or an API client.');
  }
  next();
};
