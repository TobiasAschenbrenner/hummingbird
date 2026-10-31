import { createHash, randomBytes } from 'node:crypto';

import { HttpError } from '../errors/http-error.ts';
import type { AuthenticationService } from '../models/session.model.ts';
import type { createSessionQueries } from '../queries/session.queries.ts';
import type { createUserQueries } from '../queries/user.queries.ts';
import { verifyPassword } from './password.service.ts';

export const SESSION_DURATION_MS = 24 * 60 * 60 * 1000;

function tokenHash(token?: string): string | undefined {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return undefined;
  return createHash('sha256').update(token).digest('hex');
}

export function createAuthenticationService(
  users: Pick<ReturnType<typeof createUserQueries>, 'findUserByEmail'>,
  sessions: ReturnType<typeof createSessionQueries>,
): AuthenticationService {
  return {
    async login({ email, password }, previousToken) {
      const user = await users.findUserByEmail(email);
      const validPassword = await verifyPassword(password, user?.passwordHash);
      if (!user || !validPassword) {
        throw new HttpError(401, 'Invalid email or password.');
      }

      const token = randomBytes(32).toString('base64url');
      const createdAt = new Date();
      const expiresAt = new Date(createdAt.getTime() + SESSION_DURATION_MS);
      await sessions.replaceSession(
        { tokenHash: tokenHash(token)!, userId: user.id, createdAt, expiresAt },
        tokenHash(previousToken),
      );
      return {
        user: { id: user.id, username: user.username, email: user.email },
        token,
        expiresAt,
      };
    },

    async getUser(token) {
      const hash = tokenHash(token);
      return hash ? sessions.findSessionUser(hash, new Date()) : null;
    },

    async logout(token) {
      const hash = tokenHash(token);
      if (hash) await sessions.deleteSession(hash);
    },
  };
}
