import { json, type RequestHandler } from 'express';

import { HttpError } from '../errors/http-error.ts';

const requireJson: RequestHandler = (request, _response, next) => {
  if (!request.is('application/json')) {
    throw new HttpError(415, 'Send request data as application/json.');
  }
  const charset = request.get('Content-Type')?.match(/;\s*charset\s*=\s*"?([^;"\s]+)/i)?.[1];
  if (charset && charset.toLowerCase() !== 'utf-8') {
    throw new HttpError(415, 'Use UTF-8 JSON.');
  }
  next();
};

export const accountJsonBody = [requireJson, json({ limit: '16kb', inflate: false })];
export const articleJsonBody = [requireJson, json({ limit: '128kb', inflate: false })];
