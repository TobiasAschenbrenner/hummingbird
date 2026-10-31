import { HttpErrorResponse } from '@angular/common/http';

import { AuthField, AuthFieldErrors } from '../../models/auth.model';

export function readAuthError(error: unknown): { message: string; fields: AuthFieldErrors } {
  const fallback = { message: 'Unable to complete this request. Please try again.', fields: {} };
  if (!(error instanceof HttpErrorResponse) || ![400, 401, 403, 409, 429].includes(error.status))
    return fallback;
  const details: unknown = error.error?.error;
  if (
    !details ||
    typeof details !== 'object' ||
    !('message' in details) ||
    typeof details.message !== 'string'
  )
    return fallback;
  const fields: AuthFieldErrors = {};
  if ('fields' in details && details.fields && typeof details.fields === 'object') {
    for (const field of ['username', 'email', 'password'] as AuthField[]) {
      const value: unknown = (details.fields as Record<string, unknown>)[field];
      if (typeof value === 'string') fields[field] = value;
    }
  }
  return { message: details.message, fields };
}
