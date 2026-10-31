import type { PublicUser } from './user.model.ts';

export interface LoginInput {
  email: string;
  password: string;
}

export interface AuthenticatedSession {
  user: PublicUser;
  token: string;
  expiresAt: Date;
}

export interface CreateSessionInput {
  tokenHash: string;
  userId: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface AuthenticationService {
  login(input: LoginInput, previousToken?: string): Promise<AuthenticatedSession>;
  getUser(token?: string): Promise<PublicUser | null>;
  logout(token?: string): Promise<void>;
}
