import { HttpErrorResponse } from '@angular/common/http';

export function readCoverChangeError(error: unknown): {
  message: string;
  needsReview: boolean;
  sessionExpired: boolean;
} {
  const status = error instanceof HttpErrorResponse ? error.status : 0;
  const messages: Record<number, string> = {
    400: 'Choose a valid, static JPEG, PNG or WebP image up to 5 MiB and 20 million pixels.',
    413: 'Choose a valid, static JPEG, PNG or WebP image up to 5 MiB and 20 million pixels.',
    415: 'Choose a valid, static JPEG, PNG or WebP image up to 5 MiB and 20 million pixels.',
    429: 'Too many image changes. Wait a minute before trying again.',
    503: 'Image uploads are not configured on the server.',
  };
  return {
    message:
      messages[status] ??
      'The image change could not be confirmed. Reload and review the article before trying again.',
    needsReview: ![400, 413, 415, 429, 503].includes(status),
    sessionExpired: status === 401,
  };
}
