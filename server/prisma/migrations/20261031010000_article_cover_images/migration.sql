CREATE TABLE "cover_images" (
  "public_id" VARCHAR(250) PRIMARY KEY,
  "article_id" INTEGER,
  "url" VARCHAR(2048), "width" INTEGER, "height" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cover_images_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "cover_images_metadata" CHECK (
    ("url" IS NULL AND "width" IS NULL AND "height" IS NULL AND "article_id" IS NULL) OR
    ("url" IS NOT NULL AND "width" BETWEEN 1 AND 1600 AND "height" BETWEEN 1 AND 1600 AND "width" IS NOT NULL AND "height" IS NOT NULL)
  ),
  CONSTRAINT "cover_images_namespace" CHECK ("public_id" ~ '^hummingbird/(development|test|production)/article-covers/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
);
CREATE UNIQUE INDEX "cover_images_article_id_key" ON "cover_images"("article_id");
CREATE INDEX "ix_cover_images_cleanup" ON "cover_images"("article_id", "created_at");
