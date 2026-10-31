import { EmailAlreadyExistsError } from '../errors/email-already-exists.error.ts';
import { Prisma, type PrismaClient } from '../generated/prisma/client.ts';
import type { CreateUserInput, PublicUser } from '../models/user.model.ts';

function isEmailConstraint(error: Prisma.PrismaClientKnownRequestError): boolean {
  const adapterError = error.meta?.driverAdapterError;
  const cause = adapterError instanceof Error ? adapterError.cause : undefined;
  if (!cause || typeof cause !== 'object' || !('constraint' in cause)) return false;
  const constraint = cause.constraint;
  return (
    !!constraint &&
    typeof constraint === 'object' &&
    'index' in constraint &&
    constraint.index === 'users_email_key'
  );
}

export function createUserQueries(database: PrismaClient) {
  return {
    findUserByEmail(email: string) {
      return database.user.findUnique({
        where: { email },
        select: { id: true, username: true, email: true, passwordHash: true },
      });
    },
    async createUser(input: CreateUserInput): Promise<PublicUser> {
      try {
        return await database.user.create({
          data: input,
          select: { id: true, username: true, email: true },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002' &&
          isEmailConstraint(error)
        ) {
          throw new EmailAlreadyExistsError();
        }
        throw error;
      }
    },
  };
}
