export interface User {
  id: number;
  username: string;
  email: string;
}

export interface UserResponse {
  user: User;
}

export interface LoginInput {
  email: string;
  password: string;
}

export interface RegistrationInput extends LoginInput {
  username: string;
}

export type SessionStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';
export type AuthField = 'username' | 'email' | 'password';
export type AuthFieldErrors = Partial<Record<AuthField, string>>;
