import type { Request, Response } from 'express';

import type { RegisterUser } from '../models/user.model.ts';
import { parseRegistration } from '../validators/registration.validator.ts';

export function createRegisterController(registerUser: RegisterUser) {
  return async (request: Request, response: Response) => {
    const input = parseRegistration(request.body);
    const { id, username, email } = await registerUser(input);
    response.status(201).json({ user: { id, username, email } });
  };
}
