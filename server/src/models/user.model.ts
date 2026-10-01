export interface RegistrationInput {
  username: string;
  email: string;
  password: string;
}

export interface PublicUser {
  id: number;
  username: string;
  email: string;
}

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
}

export type RegisterUser = (input: RegistrationInput) => Promise<PublicUser>;
