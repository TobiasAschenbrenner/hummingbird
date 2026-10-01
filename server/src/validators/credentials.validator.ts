import validator from 'validator';

import { HttpError } from '../errors/http-error.ts';
import type { LoginInput } from '../models/session.model.ts';

export function isWellFormed(value: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(value);
}

export function isValidEmail(email: string): boolean {
  return (
    email.length <= 120 &&
    !/[^\x21-\x7E]/.test(email) &&
    validator.isEmail(email, { allow_utf8_local_part: false })
  );
}

export function isValidPassword(password: string, minimumLength = 15): boolean {
  const length = [...password].length;
  return length >= minimumLength && length <= 128 && !!password.trim() && isWellFormed(password);
}

export function parseLogin(body: unknown): LoginInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Provide email and password in a JSON object.');
  }
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some((field) => !['email', 'password'].includes(field))) {
    throw new HttpError(400, 'Only email and password are accepted.');
  }
  const rawEmail = typeof input.email === 'string' ? input.email.trim() : '';
  const email = rawEmail.toLowerCase();
  const password = typeof input.password === 'string' ? input.password : '';
  const fields: Record<string, string> = {};
  if (!isValidEmail(rawEmail)) {
    fields.email = 'Use a valid ASCII email address of at most 120 characters.';
  }
  if (!isValidPassword(password, 1)) {
    fields.password = 'Provide your password, using at most 128 characters.';
  }
  if (Object.keys(fields).length) {
    throw new HttpError(400, 'Please check your login details.', fields);
  }
  return { email, password };
}
