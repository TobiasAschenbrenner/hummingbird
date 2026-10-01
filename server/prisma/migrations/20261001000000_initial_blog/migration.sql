BEGIN;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" VARCHAR(80) NOT NULL,
    "email" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(250) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "articles" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "title" VARCHAR(55) NOT NULL,
    "description" VARCHAR(250) NOT NULL,
    "body" TEXT NOT NULL,
    "version" BIGINT NOT NULL DEFAULT 1,
    "image_filename" VARCHAR(250),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "author_id" INTEGER NOT NULL,
    "category_id" INTEGER NOT NULL,

    CONSTRAINT "articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(80) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" SERIAL NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(40) NOT NULL,

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "article_tags" (
    "article_id" INTEGER NOT NULL,
    "tag_id" INTEGER NOT NULL,

    CONSTRAINT "article_tags_pkey" PRIMARY KEY ("article_id","tag_id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" SERIAL NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "article_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "articles_slug_key" ON "articles"("slug");

-- CreateIndex
CREATE INDEX "ix_articles_author_id" ON "articles"("author_id");

-- CreateIndex
CREATE INDEX "ix_articles_category_id" ON "articles"("category_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "tags_slug_key" ON "tags"("slug");

-- CreateIndex
CREATE INDEX "ix_article_tags_tag_id" ON "article_tags"("tag_id");

-- CreateIndex
CREATE INDEX "ix_comments_article_id_id" ON "comments"("article_id", "id");

-- CreateIndex
CREATE INDEX "ix_comments_author_id" ON "comments"("author_id");

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "articles" ADD CONSTRAINT "articles_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "article_tags" ADD CONSTRAINT "article_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- PostgreSQL checks are maintained here because Prisma schema does not represent them.
ALTER TABLE "users"
    ADD CONSTRAINT "users_username_not_blank" CHECK ("username" ~ '[^[:space:]]'),
    ADD CONSTRAINT "users_email_not_blank" CHECK ("email" ~ '[^[:space:]]'),
    ADD CONSTRAINT "users_email_canonical" CHECK ("email" = lower(btrim("email", E' \t\n\r\f\013'))),
    ADD CONSTRAINT "users_password_hash_not_blank" CHECK ("password_hash" ~ '[^[:space:]]');

ALTER TABLE "articles"
    ADD CONSTRAINT "articles_slug_not_blank" CHECK ("slug" ~ '[^[:space:]]'),
    ADD CONSTRAINT "articles_title_not_blank" CHECK ("title" ~ '[^[:space:]]'),
    ADD CONSTRAINT "articles_description_not_blank" CHECK ("description" ~ '[^[:space:]]'),
    ADD CONSTRAINT "articles_body_not_blank" CHECK ("body" ~ '[^[:space:]]'),
    ADD CONSTRAINT "articles_version_positive" CHECK ("version" > 0);

ALTER TABLE "categories"
    ADD CONSTRAINT "categories_slug_not_blank" CHECK ("slug" ~ '[^[:space:]]'),
    ADD CONSTRAINT "categories_name_not_blank" CHECK ("name" ~ '[^[:space:]]');

ALTER TABLE "tags"
    ADD CONSTRAINT "tags_slug_not_blank" CHECK ("slug" ~ '[^[:space:]]'),
    ADD CONSTRAINT "tags_name_not_blank" CHECK ("name" ~ '[^[:space:]]');

ALTER TABLE "comments"
    ADD CONSTRAINT "comments_body_not_blank" CHECK ("body" ~ '[^[:space:]]'),
    ADD CONSTRAINT "comments_body_length" CHECK (char_length("body") <= 2000);

COMMIT;
