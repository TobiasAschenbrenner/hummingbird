import type { RequestHandler } from 'express';

import { HttpError } from '../errors/http-error.ts';
import type { AuthenticationService } from '../models/session.model.ts';
import { createSessionCookie } from './session-cookie.ts';

export function createRequireSession(
  authentication: AuthenticationService,
  secureCookies = false,
): RequestHandler {
  const cookie = createSessionCookie(secureCookies);
  return async (request, response, next) => {
    const user = await authentication.getUser(cookie.read(request));
    if (!user) {
      cookie.clear(response);
      throw new HttpError(401, 'Please sign in.');
    }
    response.locals.user = user;
    next();
  };
}
