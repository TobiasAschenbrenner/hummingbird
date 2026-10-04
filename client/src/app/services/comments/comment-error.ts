import { HttpErrorResponse } from '@angular/common/http';
export function readCommentError(error: unknown): {
  message: string;
  sessionExpired: boolean;
  uncertain: boolean;
  blocked: boolean;
} {
  if (
    !(error instanceof HttpErrorResponse) ||
    ![400, 401, 403, 404, 409, 413, 415, 429].includes(error.status)
  )
    return {
      message:
        'We couldn’t confirm your comment. Retry this same submission safely using the button below.',
      sessionExpired: false,
      uncertain: true,
      blocked: false,
    };
  const messages: Record<number, string> = {
    400: 'Please check your comment. Use 1–2,000 characters without unsafe control characters.',
    401: 'Your session expired. Sign in again to post your comment.',
    403: 'Commenting was blocked. Reload Hummingbird before trying again.',
    404: 'This article no longer exists. Copy your draft before leaving.',
    409: 'The article or submission changed. Copy your draft, then reload this page.',
    413: 'The request is too large. Shorten your comment before posting.',
    415: 'The request format was rejected. Reload Hummingbird before posting.',
    429: 'Too many comments. Wait a minute before trying again.',
  };
  return {
    message: messages[error.status],
    sessionExpired: error.status === 401,
    uncertain: false,
    blocked: [403, 404, 409, 415].includes(error.status),
  };
}

export function readCommentDeletionError(error: unknown): {
  message: string;
  sessionExpired: boolean;
  needsReview: boolean;
  missing: boolean;
  articleChanged: boolean;
} {
  if (
    !(error instanceof HttpErrorResponse) ||
    ![400, 401, 403, 404, 409, 413, 415, 429].includes(error.status)
  )
    return {
      message: 'We couldn’t confirm deletion. Reload comments before trying again.',
      sessionExpired: false,
      needsReview: true,
      missing: false,
      articleChanged: false,
    };
  const messages: Record<number, string> = {
    400: 'Deletion was rejected. Reload comments before trying again.',
    401: 'Your session expired. Sign in again, then reload comments before deleting.',
    403: 'You cannot delete this comment. Check your account and reload comments.',
    404: 'This comment is no longer available.',
    409: 'The article at this URL changed. Reload the article before deleting.',
    413: 'Deletion was rejected. Reload comments before trying again.',
    415: 'The request format was rejected. Reload Hummingbird before deleting.',
    429: 'Too many comment changes. Wait a minute before trying again.',
  };
  return {
    message: messages[error.status],
    sessionExpired: error.status === 401,
    needsReview: error.status !== 429,
    missing: error.status === 404,
    articleChanged: error.status === 409,
  };
}
