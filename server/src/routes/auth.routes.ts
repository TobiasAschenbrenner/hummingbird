import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import {
  createAuthenticationControllers,
  createRegisterController,
} from '../controllers/auth.controller.ts';
import { requireApiRequest } from '../middleware/api-request.ts';
import { accountJsonBody } from '../middleware/json-body.ts';
import { createSessionCookie } from '../middleware/session-cookie.ts';
import type { AuthenticationService } from '../models/session.model.ts';
import type { RegisterUser } from '../models/user.model.ts';

export interface AuthOptions {
  registerUser: RegisterUser;
  authentication: AuthenticationService;
  secureCookies?: boolean;
}

export function createAuthRouter({
  registerUser,
  authentication,
  secureCookies = false,
}: AuthOptions) {
  const router = Router();
  const registrationLimit = rateLimit({
    windowMs: 60_000,
    limit: 50,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many registration attempts. Try again later.' } },
  });
  const loginLimit = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many login attempts. Try again later.' } },
  });
  const controllers = createAuthenticationControllers(
    authentication,
    createSessionCookie(secureCookies),
  );
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.post(
    '/register',
    registrationLimit,
    accountJsonBody,
    createRegisterController(registerUser),
  );
  router.post('/login', loginLimit, requireApiRequest, accountJsonBody, controllers.login);
  router.get('/me', controllers.currentUser);
  router.post('/logout', requireApiRequest, controllers.logout);
  return router;
}
