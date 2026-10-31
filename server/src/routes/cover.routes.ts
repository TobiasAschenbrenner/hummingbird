import { createCoverControllers } from '../controllers/cover.controller.ts';
import { Router, raw } from 'express';
import { rateLimit } from 'express-rate-limit';
import { HttpError } from '../errors/http-error.ts';
import { requireApiRequest } from '../middleware/api-request.ts';
import { createRequireSession } from '../middleware/require-session.ts';
import type { AuthenticationService } from '../models/session.model.ts';
import type { CoverService } from '../services/cover.service.ts';

export function createCoverRouter(options: {
  covers?: CoverService;
  authentication: AuthenticationService;
  secureCookies?: boolean;
}) {
  const router = Router({ mergeParams: true });
  const writes = rateLimit({
    windowMs: 60_000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many image changes. Try again later.' } },
  });
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.use(
    writes,
    requireApiRequest,
    createRequireSession(options.authentication, options.secureCookies),
  );
  const controllers = createCoverControllers(options.covers);
  router.use(controllers.prepare);
  router.put(
    '/',
    (request, _response, next) => {
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(request.get('Content-Type') ?? ''))
        throw new HttpError(415, 'Send the JPEG, PNG or WebP file as the request body.');
      next();
    },
    raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '5mb', inflate: false }),
    controllers.upload,
  );
  router.delete('/', controllers.remove);
  return router;
}
