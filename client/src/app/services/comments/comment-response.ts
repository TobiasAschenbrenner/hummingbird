import { COMMENT_PAGE_SIZE, CommentPage, PublicComment } from '../../models/comment.model';
import { isCommentId } from '../../validators/comment.validator';
function invalid(): never {
  throw new Error('Unexpected comment API response.');
}
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function readComment(value: unknown, articleId: number): PublicComment {
  const data = record(value);
  const author = record(data['author']);
  const date = data['createdAt'];
  const body = data['body'];
  const username = author['username'];
  if (
    !isCommentId(data['id']) ||
    data['articleId'] !== articleId ||
    !isCommentId(author['id']) ||
    typeof username !== 'string' ||
    !username.trim() ||
    [...username].length > 80 ||
    typeof body !== 'string' ||
    !body.trim() ||
    [...body].length > 2000 ||
    typeof date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date) ||
    !Number.isFinite(Date.parse(date))
  )
    invalid();
  return {
    id: data['id'],
    articleId,
    body,
    createdAt: date,
    author: { id: author['id'], username },
  };
}
export function readCommentPage(value: unknown, articleId: number, before?: number): CommentPage {
  const data = record(value);
  const total = data['total'];
  const nextCursor = data['nextCursor'];
  if (
    data['articleId'] !== articleId ||
    !Array.isArray(data['comments']) ||
    typeof total !== 'number' ||
    !Number.isSafeInteger(total) ||
    total < 0
  )
    invalid();
  const comments = data['comments'].map((value) => readComment(value, articleId));
  if (
    comments.length > COMMENT_PAGE_SIZE ||
    total < comments.length ||
    comments.some(
      (comment, index) =>
        (before !== undefined && comment.id >= before) ||
        (index > 0 && comment.id >= comments[index - 1]!.id),
    ) ||
    (nextCursor !== null &&
      (!isCommentId(nextCursor) ||
        comments.length !== COMMENT_PAGE_SIZE ||
        nextCursor !== comments.at(-1)?.id))
  )
    invalid();
  return { articleId, comments, total, nextCursor: nextCursor as number | null };
}
export function readPostedComment(
  value: unknown,
  articleId: number,
  body: string,
  authorId: number,
): PublicComment {
  const comment = readComment(record(value)['comment'], articleId);
  if (comment.body !== body || comment.author.id !== authorId) invalid();
  return comment;
}
