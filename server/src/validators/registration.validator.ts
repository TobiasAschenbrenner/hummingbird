import validator from 'validator';

import { HttpError } from '../errors/http-error.ts';
import type { RegistrationInput } from '../models/user.model.ts';

function isWellFormed(value: string): boolean {
  return !/[\uD800-\uDFFF]/u.test(value);
}

export function parseRegistration(body: unknown): RegistrationInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'Provide username, email and password in a JSON object.');
  }

  const input = body as Record<string, unknown>;
  const allowedFields = ['username', 'email', 'password'];
  if (Object.keys(input).some((field) => !allowedFields.includes(field))) {
    throw new HttpError(400, 'Only username, email and password are accepted.');
  }

  const username = typeof input.username === 'string' ? input.username.trim() : '';
  const rawEmail = typeof input.email === 'string' ? input.email.trim() : '';
  const email = rawEmail.toLowerCase();
  const password = typeof input.password === 'string' ? input.password : '';
  const fields: Record<string, string> = {};

  if (
    !username ||
    [...username].length > 80 ||
    !isWellFormed(username) ||
    /\p{Cc}/u.test(username)
  ) {
    fields.username = 'Use 1–80 characters without control characters.';
  }

  if (
    email.length > 120 ||
    /[^\x21-\x7E]/.test(rawEmail) ||
    !validator.isEmail(email, { allow_utf8_local_part: false })
  ) {
    fields.email = 'Use a valid ASCII email address of at most 120 characters.';
  }

  const passwordLength = [...password].length;
  if (passwordLength < 15 || passwordLength > 128 || !password.trim() || !isWellFormed(password)) {
    fields.password = 'Use 15–128 characters, not only whitespace.';
  }

  if (Object.keys(fields).length) {
    throw new HttpError(400, 'Please check your registration details.', fields);
  }

  return { username, email, password };
}
