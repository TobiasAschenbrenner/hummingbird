import type { Request, Response } from 'express';
import type { CommentQueries } from '../models/comment.model.ts';
import type { PublicUser } from '../models/user.model.ts';
import { parseArticleSlug } from '../validators/article.validator.ts';
import {
  parseCommentCreation,
  parseCommentCursor,
  parseCommentDeletion,
  parseCommentId,
} from '../validators/comment.validator.ts';

export function createCommentControllers(comments: CommentQueries) {
  return {
    async list(request: Request, response: Response) {
      const slug = parseArticleSlug(request.params.slug);
      const before = parseCommentCursor(request.query);
      response.json(await comments.listComments({ slug, before }));
    },
    async delete(request: Request, response: Response<unknown, { user: PublicUser }>) {
      const slug = parseArticleSlug(request.params.slug);
      const commentId = parseCommentId(request.params.commentId);
      const input = parseCommentDeletion(request.body);
      await comments.deleteComment({
        ...input,
        slug,
        commentId,
        authorId: response.locals.user.id,
      });
      response.status(204).end();
    },
    async create(request: Request, response: Response<unknown, { user: PublicUser }>) {
      const slug = parseArticleSlug(request.params.slug);
      const input = parseCommentCreation(request.body);
      const result = await comments.createComment({
        ...input,
        slug,
        authorId: response.locals.user.id,
      });
      response.status(result.created ? 201 : 200).json({ comment: result.comment });
    },
  };
}
