# Hummingbird API 🐦

Express, TypeScript and Prisma API for the rewrite. Accounts, article listing
and article details are available; publishing and comments come later.
The [Angular client](../client/README.md) uses it for account flows and an API connection check.

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
metadata; the rewrite does not serve uploaded images yet. Render article bodies
as text in the future client, not as trusted HTML.

Slugs use 1–80 lowercase letters/digits separated by single hyphens. A valid
missing slug returns `404`; invalid slugs or pagination return `400`. Database
failures return the same safe `500` error as other API routes. Responses are not
cached. Search, category/tag filters, publishing and comment routes are not yet
implemented; unsupported list query parameters return `400`.

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
changed data and exact bigint serialization.
The test database is emptied before each test and when the suite finishes.

Import [the Postman collection](../postman/hummingbird.postman_collection.json).
Its `baseUrl` defaults to `http://127.0.0.1:3000`; change it if you use another port.
Run the requests in order: **Register account**, **Duplicate email**, **Login**,
**Current user**, **Wrong password**, **Session still active**, **Logout**, then
**Session revoked**. Keep Postman's cookie jar enabled; the collection includes
the required request header and checks each response.

The article requests are read-only and work without a session. **List articles**
works with an empty database; when articles exist it saves a slug for **Article
detail**. If the catalog is empty, run `npm run db:seed:demo` in development or set
`articleSlug` to an existing slug before running the detail request. **Invalid
article page** checks validation. These reads do not create or change database rows.

Registration generates a new test address each time. These requests create real
accounts and sessions in the configured rewrite database. The collection's password
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
