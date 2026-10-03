# Hummingbird API 🐦

Express, TypeScript and Prisma API for the rewrite. Accounts, article browsing,
publishing, editing and deletion are available; comments come later.
The [Angular client](../client/README.md) supports these flows.

## 🚀 Getting started

Use Node.js 24 (24.12.0 or newer). From the repository root:

```bash
nvm install
nvm use
cd server
npm ci
```

Configure the database below, then run `npm run dev`.

## 🔧 Configuration

Copy `.env.example` to `.env` inside `server/`, unless it already exists.
Replace `replace-me` in the three database URLs with your role's password.
Percent-encode special characters in URL credentials (for example, `@` becomes `%40`).

| Variable              | Purpose                                               |
| --------------------- | ----------------------------------------------------- |
| `PORT`                | API port; defaults to `3000`                          |
| `NODE_ENV`            | `development` (default), `test` or `production`       |
| `DATABASE_URL`        | Required rewrite database connection                  |
| `SHADOW_DATABASE_URL` | Separate, disposable database for creating migrations |
| `TEST_DATABASE_URL`   | Separate, disposable database ending in `_test`       |

Run the scripts from `server/`. They load only its optional `.env`; the Flask
configuration at the repository root is separate. Environment files stay out of Git.

## 🗄️ PostgreSQL setup

Keep the Flask database `hummingbird` unchanged. With PostgreSQL running, create a
new role and three databases once, using an account allowed to create them:

```bash
createuser -h localhost --pwprompt hummingbird_rewrite
createdb -h localhost --owner=hummingbird_rewrite hummingbird_rewrite
createdb -h localhost --owner=hummingbird_rewrite hummingbird_rewrite_shadow
createdb -h localhost --owner=hummingbird_rewrite hummingbird_rewrite_test
```

The role does not need superuser or database-creation privileges. Set its password
in `server/.env`, then apply the committed migrations from `server/`:

```bash
npm run db:deploy
npm run db:status
```

The [Prisma schema](prisma/schema.prisma) defines the tables and relations.
[SQL migrations](prisma/migrations/) also enforce nonblank content, positive
article versions and a 2,000-character comment limit. Emails must be stored
trimmed and lowercase so the unique key treats login addresses consistently.

For future schema changes, use `npm run db:migrate -- --name describe_change`,
then `npm run db:generate`. Review the generated SQL before committing it; use
`--create-only` to add [SQL constraints that Prisma cannot represent](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/unsupported-database-features).
Use migrations rather than `prisma db push`, which would miss those constraints.

> [!WARNING]
> Prisma erases the shadow database while creating migrations. Tests erase data in
> the test database. Neither URL may point at the development or Flask database.

## 🌱 Seed data

After applying migrations, add the default categories (**Tech, Design, Mobile**):

```bash
npm run db:seed
```

For optional demo content in the local rewrite database:

```bash
npm run db:seed:demo
```

On an empty database, the demo creates 3 categories, 2 users, 3 articles, 3 tags,
5 article–tag links and 2 comments. The sample text and UTC timestamps are fixed
in [seed-data.ts](prisma/seed-data.ts); no external data or images are downloaded.
This is a small development fixture, not a performance benchmark dataset.

Both commands add missing records in one transaction without overwriting existing
content. Repeated runs create no duplicates. Existing article slugs are skipped,
including their tags and comments, so user edits and removed links stay unchanged.
Demo emails already used by login accounts cause the entire seed to roll back.

Demo mode requires `development` or `test`, a local host, and the database name
`hummingbird_rewrite` or `hummingbird_rewrite_test`. Use a plain database URL or
`?schema=public`, without connection overrides. Demo authors have a disabled
password marker, not a shared login password. Register your own account through
the API, then sign in with your own credentials.

Seeds [run explicitly](https://www.prisma.io/docs/orm/v7/prisma-migrate/workflows/seeding),
not automatically during migrations. They do not change the schema or reset data.

## 🔍 DataGrip

Add a [PostgreSQL data source](https://www.jetbrains.com/help/datagrip/postgresql.html)
using the details from `server/.env`:

| Field    | Local value                              |
| -------- | ---------------------------------------- |
| Host     | `localhost`                              |
| Port     | `5432`                                   |
| Database | `hummingbird_rewrite`                    |
| User     | `hummingbird_rewrite`                    |
| Password | The password in `DATABASE_URL` (decoded) |
| Schema   | `public`                                 |

Test the connection, then refresh the schema to inspect tables, foreign keys and
indexes. Change the schema through migrations, not DataGrip's table editor.

## ▶️ Run the API

```bash
npm run dev
```

Open [the health endpoint](http://127.0.0.1:3000/api/health). It returns
`{"status":"ok"}`. This checks that the API is running, not database availability.
The server currently listens only on your own computer (`127.0.0.1`).

## 👤 Register an account

Send `POST /api/auth/register` with `Content-Type: application/json`:

```json
{
  "username": "Author",
  "email": "author@example.com",
  "password": "replace with your own long password"
}
```

- **Username:** 1–80 characters after trimming; no control characters. Names may be shared.
- **Email:** Valid ASCII address, at most 120 characters; trimmed and stored lowercase.
- **Password:** 15–128 characters, not only whitespace. Unicode and spaces are preserved.

Success returns `201` and `{ "user": { "id": 1, "username": "Author", "email": "author@example.com" } }`.
Passwords are stored as salted Argon2id hashes using [OWASP's recommended minimum settings](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
Responses never include passwords or hashes. Registration does not sign you in.

| Status | Meaning                                       |
| ------ | --------------------------------------------- |
| `400`  | Invalid fields or JSON                        |
| `409`  | Email already registered                      |
| `413`  | Body exceeds 16 KiB                           |
| `415`  | Wrong media type, charset or compressed body  |
| `429`  | More than 50 attempts per IP per minute       |
| `500`  | Unexpected failure; internal details withheld |

Validation errors include `error.fields`; other errors contain `error.message`.
The database unique key handles duplicate emails even during concurrent requests.
The request limit is kept in memory per server process and resets on restart.

## 🔑 Login and sessions

| Request                 | Result                                   |
| ----------------------- | ---------------------------------------- |
| `POST /api/auth/login`  | Sign in with an email and password       |
| `GET /api/auth/me`      | Return the current `{ "user": { ... } }` |
| `POST /api/auth/logout` | Revoke the current session; return `204` |

Login accepts UTF-8 JSON with the same email normalization as registration.
Passwords are checked unchanged. Unknown accounts, wrong passwords and disabled
demo accounts return the same `401` error. Login is limited to 20 attempts per IP
per minute; the in-memory limits reset on restart and are not shared across servers.

Login and logout require `X-Hummingbird-Request: 1`. Browser requests must use the
same origin through Angular's `/api` proxy; cross-origin CORS access is not enabled.
This [custom-header protection](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html#employing-custom-request-headers-for-ajaxapi)
guards cookie-based requests against CSRF. Use the same middleware for future write routes.

The browser receives an HTTP-only, `SameSite=Lax` cookie, never a token in JSON or
local storage. PostgreSQL stores only its SHA-256 hash, user ID and timestamps.
Sessions expire after 24 hours without renewal. A successful login replaces the
presented session in one transaction and removes expired rows; other devices stay
signed in. Logout invalidates copied cookies too. Sessions survive API restarts.

Without a valid session, `/me` returns `401` and clears the stale cookie.
Logout is safe to repeat. All account responses use `Cache-Control: no-store`.
Set `NODE_ENV=production` behind HTTPS to use a Secure `__Host-` cookie; local
HTTP development uses `hummingbird_session`. Hosting configuration comes later.
See [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html)
for the cookie and session design.

## 📚 Read articles

| Request                   | Result                                      |
| ------------------------- | ------------------------------------------- |
| `GET /api/articles`       | Article summaries and pagination            |
| `GET /api/articles/:slug` | One article, including its body and version |

Both routes are public; no login or request header is needed. Lists show newest
creation timestamps first, then highest IDs to break ties. Use `page` (1–10,000)
and `pageSize` (1–50); defaults are 1 and 12. For example:

```text
GET /api/articles?page=2&pageSize=12
```

The response is `{ "articles": [...], "pagination": { "page": 2, "pageSize": 12,
"total": 3, "totalPages": 1 } }`. Empty catalogs and pages beyond the total return
`200` with an empty list; empty catalogs have zero total pages.
The list and total use one repeatable-read transaction for a consistent snapshot.

Summaries include the author ID and display name, category, alphabetically sorted
tags and comment count, but no body or private account fields. Details return
`{ "article": { ... } }` with the body and a decimal-string version to preserve
PostgreSQL bigint precision. Dates are UTC ISO strings. `imageFilename` is nullable
metadata; the rewrite does not serve uploaded images yet. The client renders
article bodies as text, not as trusted HTML.

Slugs use 1–80 lowercase letters/digits separated by single hyphens. A valid
missing slug returns `404`; invalid slugs or pagination return `400`. Database
failures return the same safe `500` error as other API routes. Responses are not
cached. Search, category/tag filters and comment routes are not
yet implemented; unsupported list query parameters return `400`.

## ✍️ Publish articles

`GET /api/categories` and `GET /api/tags` return public `{ "categories": [...] }`
and `{ "tags": [...] }` options with ID, slug and name, sorted by name then ID.
Empty catalogs return empty arrays. Run `npm run db:seed` for categories;
optional demo seeding also adds tags. These routes do not create catalog entries.

`POST /api/articles` requires a valid session cookie, `X-Hummingbird-Request: 1`
and UTF-8 `application/json` (at most 128 KiB). Use IDs from the catalog routes:

```json
{
  "slug": "learning-relational-databases",
  "title": "Learning relational databases",
  "description": "Tables, keys and shared tags in a blog.",
  "body": "First paragraph.\n\nSecond paragraph.",
  "categoryId": 1,
  "tagIds": [1, 2]
}
```

Titles use 1–55 characters, descriptions 1–250 and bodies 1–20,000, counting
Unicode characters. Title and description are trimmed; body whitespace is preserved.
Blank text, malformed Unicode and control characters are rejected; bodies allow
line breaks and tabs. Slugs follow the read-route rules. One existing category
is required; `tagIds` may be omitted or contain up to ten distinct existing IDs.

The author comes from the session. Article IDs, versions, timestamps and image
filenames cannot be supplied by the client. The article and its tag links commit in one
transaction; any failure rolls them all back. `201` returns `{ "article": { ... } }`
in the detail format and a `Location` header pointing to its API URL.

Invalid fields or missing catalog entries return `400` with `error.fields`.
Missing/expired sessions return `401`, unsafe request headers `403`, and duplicate
slugs or concurrent relationship changes `409`. Bodies over 128 KiB return `413`;
unsupported media types, charsets and compression return `415`. Publishing is
limited to 20 article changes per IP per minute (`429`), shared with editing and
deletion, and independent of public reads.
Unexpected failures return a safe `500`. The Angular creation form uses these
routes; images and catalog management are separate steps.

## ✏️ Edit articles

Send `PUT /api/articles/:slug` while signed in, with the same request header and
UTF-8 JSON requirements as publishing:

```json
{
  "title": "Updated title",
  "description": "An updated summary.",
  "body": "Updated plain text.",
  "categoryId": 1,
  "tagIds": [],
  "version": "1"
}
```

Only the author may edit (`403` otherwise); missing articles return `404`.
Supply every content field and the exact string `version` from article detail.
Use `[]` to remove all tag links. The URL slug, author, creation time, images and
comments stay unchanged. Content validation matches publishing.

The content, category, replacement tag links and version increment commit in one
transaction. A conditional update on the current version lets only one concurrent
save succeed. Stale versions return `409` with `error.fields.version`; load the
latest article and review your draft before retrying. Versions stay bigint strings,
never JavaScript numbers. Success returns `200` and `{ "article": { ... } }`.
Failed saves roll back every change. Writes are never automatically retried.

## 🗑️ Delete articles

Send `DELETE /api/articles/:slug` with a valid session, `X-Hummingbird-Request: 1`
and UTF-8 JSON (the same 128 KiB limit as other article writes):

```json
{ "articleId": 1, "version": "2" }
```

Use the ID and exact string version from the article you reviewed. Only its author
may delete it (`403` otherwise). A missing article returns `404`; a changed version
or a replacement article at the same URL returns `409`. Reload and review before
confirming again. Invalid input returns `400`; session, format and rate-limit
errors match other article writes. Success is `204` with no response body.

A conditional delete and PostgreSQL foreign-key cascades remove the article, its
comments and tag links in one transaction. Failures roll everything back. Shared
categories, tags, accounts and other articles stay intact. This is permanent,
without undo. Repeating the request returns `404`; deletion is never retried
automatically. The rewrite does not yet upload or manage image files.

## 🧪 Checks and Postman

```bash
npm run check
```

This validates the schema, checks types, runs HTTP/configuration/password tests, checks
formatting and builds the application. These tests do not need a database.

For PostgreSQL integration tests:

```bash
npm run test:db
```

They apply committed migrations to `TEST_DATABASE_URL` and test joins, uniqueness,
foreign keys, delete rules, content constraints and transaction rollback.
They also check seed repeatability, preserved edits and demo restrictions.
Registration tests cover stored password hashes, duplicates and concurrent requests.
Authentication tests cover expiry, session rotation, persistence, logout, SQL
constraints and rollback when creating a replacement session fails.
Article tests cover public reads, relation selection, stable pagination, counts,
changed data and exact bigint serialization. Publishing tests cover session ownership,
Unicode limits, missing catalog entries, concurrent duplicate slugs and rollback
when inserting tag links fails. Editing tests cover author permissions, stale and
concurrent saves, exact version increments and rollback of replaced tag links.
Deletion tests cover ownership, expired sessions, stale confirmations, URL reuse,
concurrent writes, cascades and rollback. Each database test gets a fresh API instance
so rate-limit counters do not leak between tests.
The test database is emptied before each test and when the suite finishes.

Import [the Postman collection](../postman/hummingbird.postman_collection.json).
Its `baseUrl` defaults to `http://127.0.0.1:3000`; change it if you use another port.
Run `npm run db:seed` first, then run the collection in order with Postman's
cookie jar enabled. It registers and signs in, loads catalog options, publishes
an article, checks duplicate-slug rejection and reads the stored result. It checks
stale deletion, removes its own article and verifies a repeated delete and detail
read return `404`. Logout then checks that the revoked session cannot publish, edit
or delete. Required headers and response checks are included.

The list/detail requests are public reads and work without a session. **List articles**
works with an empty database; when articles exist it saves a slug for **Article
detail**. If the catalog is empty, run `npm run db:seed:demo` in development or set
`articleSlug` to an existing slug before running the detail request. **Invalid
article page** checks validation. These reads do not create or change database rows.

**Update own article**, **Stale article edit** and **Updated article detail** verify
a save, a rejected stale save and the stored result. **Editing after logout** checks
that revoked sessions cannot save. Editing keeps the slug fixed and clears the
created article’s tag links in this collection.

Registration generates a new test address and publishing a new slug on each run.
The collection creates real accounts, sessions, articles and tag links in the
configured rewrite database. It deletes its own article during a successful full
run, but leaves the test account and shared catalog entries in place. Its password
is a test example, not a credential for a real account.

To run the compiled application, stop the development server first:

```bash
npm run build
npm start
```

Use Ctrl+C to stop either server. Compiled files and installed dependencies are
ignored by Git. The generated Prisma client is also ignored and regenerated by
`npm ci`, `npm run build` or `npm run db:generate`.

Prisma CLI dependency overrides pin patched `deepmerge-ts` and `mysql2` versions.
Recheck them when upgrading Prisma; MySQL is not used by this application.

With the pinned Prisma/pg versions, relation reads inside transactions can emit a
[driver deprecation warning](https://github.com/prisma/orm/issues/29407).
The reads and tests still pass; check adapter compatibility before upgrading pg to version 9.
