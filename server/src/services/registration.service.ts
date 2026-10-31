import type { RegisterUser } from '../models/user.model.ts';
import type { createUserQueries } from '../queries/user.queries.ts';
import { hashPassword } from './password.service.ts';

export function createRegistrationService(
  users: Pick<ReturnType<typeof createUserQueries>, 'createUser'>,
): RegisterUser {
  return async ({ username, email, password }) => {
    const passwordHash = await hashPassword(password);
    return users.createUser({ username, email, passwordHash });
  };
}
