import { Prisma, type PrismaClient } from '../generated/prisma/client.ts';
import { HttpError } from '../errors/http-error.ts';
import {
  COMMENT_PAGE_SIZE,
  type CommentQueries,
  type CreateCommentInput,
  type PublicComment,
} from '../models/comment.model.ts';

const commentSelect = {
  id: true,
  articleId: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, username: true } },
} satisfies Prisma.CommentSelect;
const replaySelect = { ...commentSelect, authorId: true } satisfies Prisma.CommentSelect;
type CommentRecord = Prisma.CommentGetPayload<{ select: typeof commentSelect }>;
type ReplayRecord = Prisma.CommentGetPayload<{ select: typeof replaySelect }>;
function toComment(comment: CommentRecord): PublicComment {
  return {
    id: comment.id,
    articleId: comment.articleId,
    body: comment.body,
    createdAt: comment.createdAt.toISOString(),
    author: comment.author,
  };
}
function replay(comment: ReplayRecord, input: CreateCommentInput) {
  if (
    comment.articleId !== input.articleId ||
    comment.authorId !== input.authorId ||
    comment.body !== input.body
  )
    throw new HttpError(409, 'This request ID already belongs to a different comment.', {
      requestId: 'Use a new request ID for a different comment.',
    });
  return { comment: toComment(comment), created: false };
}
export function createCommentQueries(database: PrismaClient): CommentQueries {
  return {
    async createComment(input) {
      try {
        return await database.$transaction(async (transaction) => {
          const article = await transaction.article.findUnique({
            where: { slug: input.slug },
            select: { id: true },
          });
          if (!article) throw new HttpError(404, 'Article not found.');
          if (article.id !== input.articleId)
            throw new HttpError(
              409,
              'The article at this URL changed. Reload it before commenting.',
            );
          const existing = await transaction.comment.findUnique({
            where: { requestId: input.requestId },
            select: replaySelect,
          });
          if (existing) return replay(existing, input);
          const comment = await transaction.comment.create({
            data: {
              articleId: article.id,
              authorId: input.authorId,
              body: input.body,
              requestId: input.requestId,
            },
            select: commentSelect,
          });
          return { comment: toComment(comment), created: true };
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          // A concurrent retry can reach the unique key before its winner is visible.
          if (error.code === 'P2002') {
            const existing = await database.comment.findUnique({
              where: { requestId: input.requestId },
              select: replaySelect,
            });
            if (existing) return replay(existing, input);
          }
          if (error.code === 'P2003')
            throw new HttpError(409, 'The article or account changed. Reload before commenting.');
        }
        throw error;
      }
    },
    async listComments({ slug, before }) {
      return database.$transaction(
        async (transaction) => {
          const article = await transaction.article.findUnique({
            where: { slug },
            select: { id: true },
          });
          if (!article) throw new HttpError(404, 'Article not found.');
          const rows = await transaction.comment.findMany({
            where: {
              articleId: article.id,
              ...(before === undefined ? {} : { id: { lt: before } }),
            },
            select: commentSelect,
            orderBy: { id: 'desc' },
            take: COMMENT_PAGE_SIZE + 1,
          });
          const total = await transaction.comment.count({ where: { articleId: article.id } });
          const comments = rows.slice(0, COMMENT_PAGE_SIZE).map(toComment);
          return {
            articleId: article.id,
            comments,
            total,
            nextCursor: rows.length > COMMENT_PAGE_SIZE ? comments.at(-1)!.id : null,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
      );
    },
  };
}
