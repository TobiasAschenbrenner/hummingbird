import { Prisma, type PrismaClient } from '../generated/prisma/client.ts';
import { HttpError } from '../errors/http-error.ts';
import type { CoverQueries, CoverTarget } from '../models/image.model.ts';
import { detailSelect, toDetail } from './article.queries.ts';

async function targetArticle(database: Prisma.TransactionClient, target: CoverTarget) {
  const article = await database.article.findUnique({
    where: { slug: target.slug },
    select: { id: true, authorId: true, version: true },
  });
  if (!article) throw new HttpError(404, 'Article not found.');
  if (article.authorId !== target.authorId)
    throw new HttpError(403, 'You can only change your own article cover.');
  if (
    article.id !== target.articleId ||
    article.version.toString() !== target.version ||
    article.version === 9223372036854775807n
  )
    throw new HttpError(409, 'The article changed. Reload it before changing its cover.');
  return article;
}

export function createCoverQueries(database: PrismaClient): CoverQueries {
  async function change(
    target: CoverTarget,
    image?: import('../models/image.model.ts').StoredImage,
  ) {
    return database.$transaction(async (transaction) => {
      await targetArticle(transaction, target);
      const locked = await transaction.article.updateMany({
        where: { id: target.articleId, authorId: target.authorId, version: BigInt(target.version) },
        data: { version: { increment: 1 } },
      });
      if (locked.count !== 1)
        throw new HttpError(409, 'The article changed. Reload it before changing its cover.');
      await transaction.coverImage.updateMany({
        where: { articleId: target.articleId },
        data: { articleId: null },
      });
      if (image) {
        const attached = await transaction.coverImage.updateMany({
          where: {
            publicId: image.publicId,
            articleId: null,
            createdAt: { gt: new Date(Date.now() - 30 * 60_000) },
          },
          data: {
            articleId: target.articleId,
            url: image.url,
            width: image.width,
            height: image.height,
          },
        });
        if (attached.count !== 1)
          throw new HttpError(
            409,
            'The upload expired. Reload the article and select the image again.',
          );
      }
      return toDetail(
        await transaction.article.findUniqueOrThrow({
          where: { id: target.articleId },
          select: detailSelect,
        }),
      );
    });
  }
  return {
    async checkTarget(target) {
      await targetArticle(database, target);
    },
    async reserve(publicId) {
      await database.coverImage.create({ data: { publicId } });
    },
    attach: (target, image) => change(target, image),
    detach: (target) => change(target),
    async listDetached(before) {
      return (
        await database.coverImage.findMany({
          where: { articleId: null, createdAt: { lt: before } },
          select: { publicId: true },
          orderBy: { createdAt: 'asc' },
          take: 100,
        })
      ).map((image) => image.publicId);
    },
    async forgetDetached(publicId, before) {
      await database.coverImage.deleteMany({
        where: { publicId, articleId: null, createdAt: { lt: before } },
      });
    },
  };
}
