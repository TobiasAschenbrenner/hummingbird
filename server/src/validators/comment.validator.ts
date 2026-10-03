import { HttpError } from '../errors/http-error.ts';
import type { CommentCreationInput } from '../models/comment.model.ts';
import { isWellFormed } from './credentials.validator.ts';

function isDatabaseId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}
export function parseCommentCreation(body: unknown): CommentCreationInput {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new HttpError(400, 'Provide comment details in a JSON object.');
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['articleId', 'body', 'requestId'].includes(key)))
    throw new HttpError(400, 'Only articleId, body and requestId are accepted.');
  const fields: Record<string, string> = {};
  const text = typeof input.body === 'string' ? input.body : '';
  if (
    !text.trim() ||
    [...text].length > 2000 ||
    !isWellFormed(text) ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(text)
  )
    fields.body =
      'Use 1–2,000 characters; only tabs and line breaks are allowed as control characters.';
  if (!isDatabaseId(input.articleId)) fields.articleId = 'Supply the current article ID.';
  if (
    typeof input.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.requestId)
  )
    fields.requestId = 'Supply a UUID v4 request ID.';
  if (Object.keys(fields).length) throw new HttpError(400, 'Please check your comment.', fields);
  return {
    articleId: input.articleId as number,
    body: text,
    requestId: (input.requestId as string).toLowerCase(),
  };
}
export function parseCommentCursor(query: Record<string, unknown>): number | undefined {
  if (Object.keys(query).some((key) => key !== 'before'))
    throw new HttpError(400, 'Only the before cursor is accepted.');
  if (query.before === undefined) return undefined;
  const value = query.before;
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,9}$/.test(value) || Number(value) > 2147483647)
    throw new HttpError(400, 'Use a positive integer comment ID for before.');
  return Number(value);
}
