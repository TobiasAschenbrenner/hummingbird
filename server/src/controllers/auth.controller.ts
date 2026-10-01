import type { Request, Response } from 'express';

import { HttpError } from '../errors/http-error.ts';
import type { createSessionCookie } from '../middleware/session-cookie.ts';
import type { AuthenticationService } from '../models/session.model.ts';
import type { RegisterUser } from '../models/user.model.ts';
import { parseLogin } from '../validators/credentials.validator.ts';
import { parseRegistration } from '../validators/registration.validator.ts';

export function createRegisterController(registerUser: RegisterUser) {
  return async (request: Request, response: Response) => {
    const input = parseRegistration(request.body);
    const { id, username, email } = await registerUser(input);
    response.status(201).json({ user: { id, username, email } });
  };
}

export function createAuthenticationControllers(
  authentication: AuthenticationService,
  cookie: ReturnType<typeof createSessionCookie>,
) {
  return {
    async login(request: Request, response: Response) {
      const input = parseLogin(request.body);
      const session = await authentication.login(input, cookie.read(request));
      const { id, username, email } = session.user;
      cookie.set(response, session.token, session.expiresAt);
      response.json({ user: { id, username, email } });
    },
    async currentUser(request: Request, response: Response) {
      const user = await authentication.getUser(cookie.read(request));
      if (!user) {
        cookie.clear(response);
        throw new HttpError(401, 'Please sign in.');
      }
      const { id, username, email } = user;
      response.json({ user: { id, username, email } });
    },
    async logout(request: Request, response: Response) {
      await authentication.logout(cookie.read(request));
      cookie.clear(response);
      response.status(204).end();
    },
  };
}
