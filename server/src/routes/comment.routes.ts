import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { createCommentControllers } from '../controllers/comment.controller.ts';
import { requireApiRequest } from '../middleware/api-request.ts';
import { commentJsonBody } from '../middleware/json-body.ts';
import { createRequireSession } from '../middleware/require-session.ts';
import type { CommentQueries } from '../models/comment.model.ts';
import type { AuthenticationService } from '../models/session.model.ts';

interface CommentOptions {
  comments: CommentQueries;
  authentication: AuthenticationService;
  secureCookies?: boolean;
}
export function createCommentRouter({
  comments,
  authentication,
  secureCookies = false,
}: CommentOptions) {
  const router = Router({ mergeParams: true });
  const controllers = createCommentControllers(comments);
  const writeLimit = rateLimit({
    windowMs: 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: { message: 'Too many comment changes. Try again later.' } },
  });
  router.use((_request, response, next) => {
    response.set('Cache-Control', 'no-store');
    next();
  });
  router.get('/', controllers.list);
  router.post(
    '/',
    writeLimit,
    requireApiRequest,
    createRequireSession(authentication, secureCookies),
    commentJsonBody,
    controllers.create,
  );
  router.delete(
    '/:commentId',
    writeLimit,
    requireApiRequest,
    createRequireSession(authentication, secureCookies),
    commentJsonBody,
    controllers.delete,
  );
  return router;
}
