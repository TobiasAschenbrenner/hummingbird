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
  const fields = readFieldErrors(error);
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

function readFieldErrors(error: HttpErrorResponse): ArticleFieldErrors {
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
  return fields;
}

export function readArticleUpdateError(error: unknown): {
  message: string;
  fields: ArticleFieldErrors;
  sessionExpired: boolean;
  needsReview: boolean;
  forbidden: boolean;
  missing: boolean;
} {
  const unknownOutcome = {
    message: 'We couldn’t confirm the save. Load the latest saved version before trying again.',
    fields: {},
    sessionExpired: false,
    needsReview: true,
    forbidden: false,
    missing: false,
  };
  if (
    !(error instanceof HttpErrorResponse) ||
    ![400, 401, 403, 404, 409, 413, 415, 429].includes(error.status)
  )
    return unknownOutcome;
  const fields = readFieldErrors(error);
  const versionConflict = !!error.error?.error?.fields?.version;
  const messages: Record<number, string> = {
    400: 'Please check your article details and selected options.',
    401: 'Your session expired. Sign in again before saving.',
    403: 'You cannot edit this article. Check your account and reload the article.',
    404: 'This article no longer exists. Your draft stays here.',
    409: versionConflict
      ? 'This article changed. Review the latest saved version before trying again.'
      : 'The selected options changed. Refresh categories and tags, then try again.',
    413: 'This request is too large. Shorten the article body before saving.',
    415: 'The request format was rejected. Reload Hummingbird and try again.',
    429: 'Too many article changes. Wait a minute before trying again.',
  };
  return {
    message: messages[error.status],
    fields,
    sessionExpired: error.status === 401,
    needsReview: versionConflict,
    forbidden: error.status === 403,
    missing: error.status === 404,
  };
}

export function readArticleDeletionError(error: unknown): {
  message: string;
  sessionExpired: boolean;
  needsReview: boolean;
  forbidden: boolean;
  missing: boolean;
} {
  const unknownOutcome = {
    message: 'We couldn’t confirm deletion. Reload the article before trying again.',
    sessionExpired: false,
    needsReview: true,
    forbidden: false,
    missing: false,
  };
  if (
    !(error instanceof HttpErrorResponse) ||
    ![400, 401, 403, 404, 409, 413, 415, 429].includes(error.status)
  )
    return unknownOutcome;
  const messages: Record<number, string> = {
    400: 'Deletion was rejected. Reload the article before trying again.',
    401: 'Your session expired. Sign in again, then reload the article before deleting.',
    403: 'You cannot delete this article. Check your account and reload it.',
    404: 'This article no longer exists.',
    409: 'This article changed. Reload and review it before confirming deletion again.',
    413: 'Deletion was rejected. Reload the article before trying again.',
    415: 'The request format was rejected. Reload Hummingbird before deleting.',
    429: 'Too many article changes. Wait a minute before trying again.',
  };
  return {
    message: messages[error.status],
    sessionExpired: error.status === 401,
    needsReview: error.status !== 429,
    forbidden: error.status === 403,
    missing: error.status === 404,
  };
}
