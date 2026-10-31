BEGIN;

-- Keep consumed creation keys after a comment is removed, without retaining its text.
CREATE TABLE "comment_requests" (
    "request_id" UUID NOT NULL,
    "comment_id" INTEGER,
    CONSTRAINT "comment_requests_pkey" PRIMARY KEY ("request_id"),
    CONSTRAINT "comment_requests_comment_id_fkey" FOREIGN KEY ("comment_id")
        REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "comment_requests_comment_id_key" ON "comment_requests"("comment_id");

-- Move every existing key before removing the redundant column.
INSERT INTO "comment_requests" ("request_id", "comment_id")
SELECT "request_id", "id" FROM "comments" WHERE "request_id" IS NOT NULL;
ALTER TABLE "comments" DROP COLUMN "request_id";

COMMIT;
