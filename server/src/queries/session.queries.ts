import type { PrismaClient } from '../generated/prisma/client.ts';
import type { CreateSessionInput } from '../models/session.model.ts';
import type { PublicUser } from '../models/user.model.ts';

export function createSessionQueries(database: PrismaClient) {
  return {
    async replaceSession(input: CreateSessionInput, previousTokenHash?: string): Promise<void> {
      await database.$transaction([
        database.session.deleteMany({
          where: {
            OR: [
              { expiresAt: { lte: input.createdAt } },
              ...(previousTokenHash ? [{ tokenHash: previousTokenHash }] : []),
            ],
          },
        }),
        database.session.create({ data: input }),
      ]);
    },

    async findSessionUser(tokenHash: string, now: Date): Promise<PublicUser | null> {
      const session = await database.session.findFirst({
        where: { tokenHash, expiresAt: { gt: now } },
        select: { user: { select: { id: true, username: true, email: true } } },
      });
      return session?.user ?? null;
    },

    async deleteSession(tokenHash: string): Promise<void> {
      await database.session.deleteMany({ where: { tokenHash } });
    },
  };
}
