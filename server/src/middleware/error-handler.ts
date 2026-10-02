import type { ErrorRequestHandler } from 'express';

import { EmailAlreadyExistsError } from '../errors/email-already-exists.error.ts';
import { HttpError } from '../errors/http-error.ts';

const bodyErrors: Record<string, { status: number; message: string }> = {
  'entity.parse.failed': { status: 400, message: 'Send a valid JSON object.' },
  'entity.too.large': { status: 413, message: 'Request body exceeds the 16 KiB limit.' },
  'encoding.unsupported': { status: 415, message: 'Compressed request bodies are not supported.' },
  'charset.unsupported': { status: 415, message: 'Use UTF-8 JSON.' },
  'request.aborted': { status: 400, message: 'Request was interrupted.' },
  'request.size.invalid': { status: 400, message: 'Invalid request size.' },
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }
  if (error instanceof HttpError) {
    response.status(error.status).json({
      error: { message: error.message, ...(error.fields ? { fields: error.fields } : {}) },
    });
    return;
  }
  if (error instanceof URIError && 'status' in error && error.status === 400) {
    response.status(400).json({ error: { message: 'Use a valid URL-encoded path.' } });
    return;
  }
  if (error instanceof EmailAlreadyExistsError) {
    response.status(409).json({ error: { message: error.message } });
    return;
  }
  if (error && typeof error === 'object' && 'type' in error && typeof error.type === 'string') {
    const bodyError = Object.hasOwn(bodyErrors, error.type) ? bodyErrors[error.type] : undefined;
    if (bodyError) {
      response.status(bodyError.status).json({ error: { message: bodyError.message } });
      return;
    }
  }
  console.error('Unexpected API error.');
  response
    .status(500)
    .json({ error: { message: 'Unable to process the request. Try again later.' } });
};
