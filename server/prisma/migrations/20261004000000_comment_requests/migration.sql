-- Existing comments remain valid; new API posts supply a UUID for safe retries.
ALTER TABLE "comments" ADD COLUMN "request_id" UUID;
CREATE UNIQUE INDEX "comments_request_id_key" ON "comments"("request_id");
