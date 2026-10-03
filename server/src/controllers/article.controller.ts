import type { Request, Response } from 'express';

import { HttpError } from '../errors/http-error.ts';
import type { ArticleQueries } from '../models/article.model.ts';
import type { PublicUser } from '../models/user.model.ts';
import {
  parseArticleCreation,
  parseArticlePage,
  parseArticleSlug,
} from '../validators/article.validator.ts';

export function createArticleControllers(articles: ArticleQueries) {
  return {
    async create(request: Request, response: Response<unknown, { user: PublicUser }>) {
      const input = parseArticleCreation(request.body);
      const article = await articles.createArticle({ ...input, authorId: response.locals.user.id });
      response.location(`/api/articles/${article.slug}`).status(201).json({ article });
    },
    async list(request: Request, response: Response) {
      response.json(await articles.listArticles(parseArticlePage(request.query)));
    },
    async detail(request: Request, response: Response) {
      const article = await articles.findArticleBySlug(parseArticleSlug(request.params.slug));
      if (!article) throw new HttpError(404, 'Article not found.');
      response.json({ article });
    },
  };
}
