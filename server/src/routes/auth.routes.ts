import { json, Router } from 'express';
import { rateLimit } from 'express-rate-limit';

import { createRegisterController } from '../controllers/auth.controller.ts';
import { HttpError } from '../errors/http-error.ts';
import type { RegisterUser } from '../models/user.model.ts';

export function createAuthRouter(registerUser: RegisterUser) {
  const router = Router();
  const registrationLimit = rateLimit({
    windowMs: 60_000,
    limit: 50,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many registration attempts. Try again later.' } },
  });

  router.post(
    '/register',
    (_request, response, next) => {
      response.set('Cache-Control', 'no-store');
      next();
    },
    registrationLimit,
    (request, _response, next) => {
      if (!request.is('application/json')) {
        throw new HttpError(415, 'Send registration details as application/json.');
      }
      const charset = request.get('Content-Type')?.match(/;\s*charset\s*=\s*"?([^;"\s]+)/i)?.[1];
      if (charset && charset.toLowerCase() !== 'utf-8') {
        throw new HttpError(415, 'Use UTF-8 JSON.');
      }
      next();
    },
    json({ limit: '16kb', inflate: false }),
    createRegisterController(registerUser),
  );

  return router;
}
