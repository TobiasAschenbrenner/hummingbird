import { HttpErrorResponse } from '@angular/common/http';

import { ArticleField, ArticleFieldErrors } from '../../models/article.model';

export function readPublicationError(error: unknown): {
  message: string;
  fields: ArticleFieldErrors;
  sessionExpired: boolean;
  checkArticle: boolean;
} {
  const fallback = {
    message: 'We couldn’t confirm publication. Check the article URL before trying again.',
    fields: {},
    sessionExpired: false,
    checkArticle: true,
  };
  if (
    !(error instanceof HttpErrorResponse) ||
    ![400, 401, 403, 409, 413, 415, 429].includes(error.status)
  )
    return fallback;
  const fields: ArticleFieldErrors = {};
  const details: unknown = error.error?.error?.fields;
  if (
    [400, 409].includes(error.status) &&
    details &&
    typeof details === 'object' &&
    !Array.isArray(details)
  ) {
    for (const field of [
      'slug',
      'title',
      'description',
      'body',
      'categoryId',
      'tagIds',
    ] as ArticleField[]) {
      const value = (details as Record<string, unknown>)[field];
      if (typeof value === 'string' && value.length <= 1000) fields[field] = value;
    }
  }
  const messages: Record<number, string> = {
    400: 'Please check your article details and selected options.',
    401: 'Your session expired. Sign in again before publishing.',
    403: 'Publishing was blocked. Reload Hummingbird and try again.',
    409: fields.slug
      ? 'An article already uses this URL. Choose another slug.'
      : 'The selected options changed. Refresh categories and tags, then try again.',
    413: 'This request is too large. Shorten the article body before publishing.',
    415: 'The request format was rejected. Reload Hummingbird and try again.',
    429: 'Too many publishing attempts. Wait a minute before trying again.',
  };
  return {
    message: messages[error.status],
    fields,
    sessionExpired: error.status === 401,
    checkArticle: error.status === 409 && !!fields.slug,
  };
}
