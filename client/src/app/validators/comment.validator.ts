import { ValidatorFn } from '@angular/forms';
export function isCommentBody(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    !!value.trim() &&
    [...value].length <= 2000 &&
    !/[\uD800-\uDFFF]/u.test(value) &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u.test(value)
  );
}
export function isCommentRequestId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  );
}
export function isCommentId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2147483647;
}
export const commentBodyValidator: ValidatorFn = (control) =>
  isCommentBody(control.value) ? null : { commentBody: true };
