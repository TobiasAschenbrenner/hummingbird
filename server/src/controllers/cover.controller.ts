import type { NextFunction, Request, Response } from 'express';
import { HttpError } from '../errors/http-error.ts';
import type { CoverService } from '../services/cover.service.ts';
import { parseArticleDeletion, parseArticleSlug } from '../validators/article.validator.ts';

export function createCoverControllers(covers?: CoverService) {
  return {
    async prepare(request: Request, response: Response, next: NextFunction) {
      if (!covers) throw new HttpError(503, 'Image uploads are not configured.');
      const slug = parseArticleSlug(request.params.slug);
      const articleId = request.get('X-Hummingbird-Article-Id');
      if (!articleId || !/^[1-9][0-9]{0,9}$/.test(articleId))
        throw new HttpError(400, 'Supply the current article ID.');
      const input = parseArticleDeletion({
        articleId: Number(articleId),
        version: request.get('X-Hummingbird-Article-Version'),
      });
      const target = { ...input, slug, authorId: response.locals.user.id };
      await covers.checkTarget(target);
      response.locals.coverTarget = target;
      next();
    },
    async upload(request: Request, response: Response) {
      response.json({
        article: await covers!.upload(
          response.locals.coverTarget,
          request.body,
          request.get('Content-Type')!,
        ),
      });
    },
    async remove(_request: Request, response: Response) {
      response.json({ article: await covers!.remove(response.locals.coverTarget) });
    },
  };
}
