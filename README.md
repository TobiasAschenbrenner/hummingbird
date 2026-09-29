# Hummingbird 🐦

Hummingbird is a blogging application built with Flask and PostgreSQL.
Readers can browse articles, and registered users can publish articles with cover images.

---

## ✨ Features

- Register, log in, and log out
- Publish articles with cover images
- Edit your own article text, category, and tags
- Replace your article's cover image
- Keep stale edit forms from overwriting newer saves
- Delete your own articles after confirmation
- Search article titles, descriptions, and text by words
- Browse the newest articles with pagination
- Read individual articles
- Post plain-text comments while signed in
- Read comments with authors, timestamps, and pagination
- Choose categories stored in the database
- Filter articles by category across all pages
- See the total number of articles in each category
- Add up to five tags when publishing an article
- Read tags on article cards and detail pages
- Filter by tag, optionally combined with a category
- Responsive frontend

### Planned features

- Deleting your own comments

---

## 🛠 Tech Stack

### Frontend

- HTML and Jinja templates
- CSS
- JavaScript

### Backend

- Python 3.10.21
- Flask
- PostgreSQL
- SQLAlchemy
- Flask-Migrate and Alembic
- Flask-Login
- Flask-WTF for CSRF protection
- Pillow for image validation

### Development

- Python's built-in unittest runner
- Ruff

---

## 📁 Project Structure

```text
hummingbird/
├── app/
│   ├── articles/      # Article models, queries, services, routes, and uploads
│   ├── comments/      # Comment models, queries, services, and routes
│   ├── users/         # Accounts and authentication
│   ├── commands/      # Demo data generation
│   ├── templates/     # Shared layouts and feature templates
│   └── static/        # Styles, scripts, and local images
├── migrations/        # Versioned database changes
├── tests/             # Application, configuration, and upload tests
└── run.py             # Application entry point
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10.21; the version is recorded in `.python-version`
- pyenv, if using the Python setup commands below
- A running PostgreSQL server

Run these commands from the repository root:

```bash
pyenv install -s 3.10.21
pyenv local 3.10.21
pyenv exec python -m venv venv
source venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

Activate the environment again whenever you open a new terminal:

```bash
source venv/bin/activate
```

---

## 🔧 Environment Variables

Create a `.env` file in the repository root if you do not already have one:

```bash
cp .env.example .env
```

```dotenv
DATABASE_URL=postgresql://hummingbird:hummingbird@localhost:5432/hummingbird
SECRET_KEY=replace-with-a-generated-secret
```

Generate a secret and paste the result into `SECRET_KEY`:

```bash
python -c 'import secrets; print(secrets.token_hex(32))'
```

The database credentials above are for local development only.
Update `DATABASE_URL` if you use different credentials. Keep `.env` private;
it is ignored by Git.

---

## 🗄️ Database Setup

For an existing Homebrew PostgreSQL 14 installation on macOS:

```bash
brew services start postgresql@14
pg_isready -h localhost -p 5432
```

Create the application role and database once:

```bash
createuser -h localhost --pwprompt hummingbird
createdb -h localhost --owner=hummingbird hummingbird
```

These commands require a local PostgreSQL account that can create roles and
databases. At the password prompt, use the password configured in `.env`.

Verify the connection:

```bash
psql -h localhost -U hummingbird -d hummingbird \
  -c "SELECT current_database(), current_user;"
```

With the virtual environment active and `.env` configured, apply the migrations:

```bash
FLASK_APP=run.py python -m flask db upgrade
FLASK_APP=run.py python -m flask db current
```

Run the upgrade command after pulling changes that introduce new migrations.
Back up any database containing data you want to keep before upgrading it.

Usernames, email addresses, and stored password hashes are required and cannot
be empty or contain only whitespace. The user-field migration stops if existing
records violate these rules; review and correct those records before retrying.
It does not rewrite or delete user data.

Article titles, URL slugs, descriptions, and bodies are also required and cannot
be empty or contain only whitespace. The article-content migration stops if
existing records violate these rules; it does not rewrite or delete articles.

The edit-version migration gives existing articles version 1 without changing
their content or relationships. Every successful edit through the application
increments the version. Downgrading removes this counter; close old edit forms
before downgrading and reapplying the migration.

Email lookup and uniqueness ignore capitalization and surrounding spaces, tabs,
and line breaks. Registration trims that whitespace but keeps the entered spelling;
existing addresses are not rewritten. Login and demo seeding use the same lookup.
A unique expression index enforces the rule in PostgreSQL. Its migration stops
if existing accounts conflict, without merging or deleting them. This is
Hummingbird's account policy; dots and `+suffixes` remain distinct.

The currently pinned SQLAlchemy/Alembic versions warn that automatic schema
comparison skips expression indexes. The email and search indexes are managed
by explicit migrations and verified by database tests.

The category migrations keep existing articles and create records for their
existing category values. Legacy articles with no category keep that missing
value and display as "Uncategorized"; new article submissions require a category.
Deleting a category still used by articles is blocked by the database.
There is no category-management screen yet.

Downgrading to the old schema is blocked if an article uses a category slug
longer than its former 10-character limit, to avoid truncating data.

The tag migration adds empty storage without changing existing articles.
Downgrading that migration removes all tags and their article associations;
back up that data before any downgrade.

The search migration adds a GIN expression index over article titles,
descriptions, and text. It indexes existing articles without rewriting them;
PostgreSQL maintains the index when their content changes. Downgrading removes
only the index. Building this index blocks writes to articles until it finishes,
so plan a maintenance window before applying it to a large, busy database.

The comments migration creates an empty table without changing existing data.
Each comment requires an existing article, an existing author, a timestamp, and
nonblank text of at most 2,000 characters. Deleting an article cascades to its
comments; deleting an account with comments is blocked. There is no account
deletion screen. Downgrading this migration permanently removes all comments;
back them up before downgrading.

---

## ▶️ Running the Application

From the repository root, with the virtual environment active:

```bash
python -m pip check
FLASK_APP=run.py python -m flask routes
FLASK_APP=run.py python -m flask run --port 5001
```

Open [http://127.0.0.1:5001](http://127.0.0.1:5001).

Keep the terminal running; press Ctrl+C to stop the server.
Restart the server after code changes. For automatic reloading during local
development only:

```bash
FLASK_APP=run.py FLASK_ENV=development python -m flask run --port 5001
```

`pip check` checks installed dependencies. `flask routes` checks application
loading; it does not test the database connection.

---

## 📝 Using Hummingbird

Choose **Log in** to register or sign in, then **New Article** to publish.
Tags are optional: enter up to five names separated by commas, such as
`Python, Databases`. Each name can contain up to 40 letters, numbers, spaces,
or single hyphens. Capitalization and equivalent spacing do not create duplicate
tags; existing display names are kept. Articles, new tags, and their associations
are saved in one transaction. A failed save rolls them back and removes the new upload.

Open one of your articles and choose **Edit Article** to update its title,
description, text, category, or tags. The form starts with the saved values.
The URL, author, and publication date stay unchanged. Emptying the
tags field removes the article's tag links, not tags used by other articles.
Only the author can open or submit the edit form; submissions also require CSRF
verification. Validation errors preserve your input without saving changes.

Choose a replacement cover image or leave the field empty to keep the current
one. Replacements use the same validation and size limits as new uploads.
The old file is removed only after the edit commits and only when no article
still references it. Failed saves discard the new upload when the database
confirms it is unused. Files are kept and errors logged if cleanup cannot be
completed safely. A database transaction cannot make filesystem changes atomic;
crashes or cleanup failures can leave unused files for later maintenance.

An edit saves the article and its tag links in one transaction. PostgreSQL locks
the article row during the save, serializing simultaneous edits to that article.
Each edit form carries the article's version. The save checks it while holding
the lock, then increments it in the same transaction, including tag-only and
cover-only edits. A stale form returns HTTP 409 without changing records or files.
Your entered text stays visible. Open the latest saved version using the link
in the error message, compare it, and copy across the changes you want to keep.
Select any replacement image again. Resubmitting the old form remains blocked.
Direct database edits must also increment `articles.version`; this check is in
the application, not a database trigger.

Choose **Delete Article** on one of your articles, review the confirmation,
then tick the checkbox and choose **Delete permanently**. **Cancel** leaves it
unchanged. Only the author can delete it, and the final POST requires CSRF
verification. Opening the confirmation page does not delete anything.

Deletion locks the article row and checks its ID and version. An outdated
confirmation returns HTTP 409; review the latest article and open a new
confirmation before trying again. Edit forms also check the ID, so an old form
cannot affect a new article that reuses a deleted article's URL.

The article, its comments, and its tag links are deleted in one transaction; accounts,
categories, and tags remain. Its cover is removed only after the deletion
commits and only if no article still uses it. Failed transactions keep the
article and cover. If the database cannot confirm the outcome, the page asks
you to check the article list; uncertain commits or cleanup failures can leave
unused images for later maintenance. There is no undo or restore screen.

### Comments

Open an article and sign in to post a comment. Comments are public, plain text,
and limited to 2,000 characters. Surrounding whitespace is removed; line breaks
are preserved. HTML is displayed as text, not executed. The server takes the
author from the signed-in account and generates the timestamp in PostgreSQL.
Posting requires a valid CSRF token. Validation errors keep your draft.

Comments appear 20 per page, newest inserted first, with author names and
timestamps including their time-zone offset. Posting redirects to the article;
refreshing that page does not repost the form. After a database error, keep the
displayed draft and check the comments before retrying, because a lost commit
acknowledgement can make the outcome uncertain. There is no duplicate-submission
protection for separate POST requests, comment editing, or individual deletion yet.

Comment forms target the article's ID, so an old form cannot post to a new
article reusing a deleted article's URL. Foreign keys prevent orphan comments
if an article is deleted while a comment is being submitted. Posting a comment
does not change the article's edit version. Deleting an article removes all its
comments, including any added after opening the deletion confirmation.

The comment list filters and paginates in PostgreSQL. A composite B-tree index
on `(article_id, id)` supports retrieving one article's comments in order;
an author index supports foreign-key checks when an account is deleted.
Authors are loaded with a join to avoid one extra query per comment. These
indexes cost extra storage and write work; performance measurements are still planned.

### Browsing and search

The homepage shows 12 articles per page, newest first. Category links filter in
the database before pagination, so they include matching articles from all pages.
The selected filters stay active when moving between pages. Click a tag on an
article to find related articles. Choose **All** to clear the category, **Clear
tag filter** to clear the tag, or **Home** to clear both. These links also work
without JavaScript.

Use **Search articles** to find words in titles, descriptions, and article text.
All entered words must appear somewhere across those fields. ASCII capitalization
is ignored; accented letters follow the database's locale. On a `C`-locale
database, `CAFÉ` and `café` can differ. Accents and different word endings remain
distinct: `database` does not match `databases`. Punctuation is parsed as plain
text, not as search operators or wildcards. There is no phrase, prefix, or relevance-ranked search.
An empty search shows the normal article list; a search containing only
punctuation returns no matches. Queries are limited to 200 characters.

Search combines with category and tag filters before pagination. The result
count includes every matching page, and results remain newest first. Changing
the search or filters starts at page 1. **Clear search** keeps the category/tag
filters; **Home** clears everything. Search URLs can be bookmarked and work
without logging in or enabling JavaScript.

The number beside each category counts all its articles, not just the current
page. With a tag or search active, counts include only matching articles.
Empty categories show zero. The counts come from one database query using
a left join, `COUNT`, and `GROUP BY`.

Search uses PostgreSQL's `simple` text-search configuration and
`plainto_tsquery` with bound parameters. The GIN index stores searchable words
and costs extra disk space and write work. PostgreSQL may still choose a table
scan for a small dataset or a broad search. The tests verify that the index can
serve the application's predicate, not that it improves measured performance;
realistic dataset and query-plan measurements remain planned.

Cover images are stored in `app/static/images/uploads/`. The folder is created
when needed and its contents are ignored by Git. New files receive unique names.
Supported extensions are PNG, JPG/JPEG, GIF, and WebP.

Upload limits:

- **5 MiB per image**; the actual file size is checked before decoding.
- **20 million pixels total**, counting all animation frames.
- **100 frames** per animated image.
- **6 MiB per form submission**, including image, text, and form overhead.

Invalid or oversized images show a form error without saving files or records.
Oversized submissions return a helpful HTTP 413 page. Streamed submissions without
a known length are rejected with HTTP 411 before parsing; browser forms send a
known length. Size limits must also be configured at the proxy when deploying.

---

## 📊 Demo Data

A new database has no users or articles. After applying migrations, run:

```bash
FLASK_APP=run.py python -m flask seed-demo
```

By default, this creates:

- One demo account: `demo@hummingbird.example`
- 18 sample articles across design, tech, and mobile
- Four reusable tags and 36 article/tag associations on a fresh database

On the first run, choose the demo account's password at the hidden prompt.
Rerunning the command fills in missing samples without changing existing demo
articles or credentials. Use `--count 30` to request 30 sample articles in total.
New demo articles receive two tags from a fixed sequence: Getting Started,
Tutorials, Databases, and Web Development. Existing articles keep their tags,
including any changes you made; rerunning the seed does not backfill older samples.

Sample dates start on January 1, 2024. Articles use an image placeholder and
cycle through the categories currently stored in the database.
These are generated sample counts, not a report of your current database size.
The dataset is intended for development, not performance measurement.
The demo command does not generate comments; add them through article pages.

---

## 🧪 Tests and Quality Checks

Tests require a separate, disposable PostgreSQL database. Create it once:

```bash
createdb -h localhost --owner=hummingbird hummingbird_test
```

With the virtual environment active, run:

```bash
TEST_DATABASE_URL=postgresql://hummingbird:hummingbird@localhost:5432/hummingbird_test \
  python -m unittest discover -v
```

Adjust the credentials if needed.

> [!WARNING]
> Database tests reset data in the configured test database. Its name must end
> in `_test`. Never use a database containing data you need to keep.

Without `TEST_DATABASE_URL`, the database tests are skipped; that is not full
verification. Upload tests use temporary folders.

The suite covers authentication, article creation, pagination, validation,
query loading, category/tag filtering, counts, rollback, image cleanup, repeatable
seeding, schema compatibility, and migration round trips. Tag tests also check
concurrent publishing, duplicate prevention, and association cleanup on deletion.
CSRF protection remains enabled during application tests, including checks for
missing, invalid, expired, and another session's tokens.
Upload tests cover image contents, damaged animation frames, size boundaries,
pixel/frame limits, and request rejection without database or file changes.
Edit tests cover stale forms, simultaneous saves, preserving drafts, and version
rollback when a save fails.
Deletion tests cover ownership, confirmation, CSRF, stale forms, reused URLs,
concurrent edits/deletes, transaction rollback, and shared-image cleanup.
Search tests cover text matching, filters, pagination, safe input handling,
content changes, migration round trips, and GIN index eligibility using `EXPLAIN`.
Comment tests cover authentication, CSRF, escaped text, length limits, pagination,
author loading, simultaneous posts, rollback, uncertain commits, article-deletion
cleanup, foreign keys, and migration round trips.

Install the optional development tools and check the code:

```bash
python -m pip install -r requirements-dev.txt
ruff check app tests run.py migrations/env.py
ruff format --check app tests run.py migrations/env.py
```

Use `ruff format app tests run.py migrations/env.py` to apply formatting.
Do not rewrite previously committed migrations; add a new migration instead.

---

## 🔐 Security Considerations

Passwords are hashed, article creation requires authentication, and database
failures trigger rollback. Uploads use generated filenames and an extension allowlist.
Pillow verifies and decodes uploaded PNG, JPEG, GIF, and WebP files before saving
them, including animated frames. The actual format must match the extension;
renamed non-images and damaged files are rejected without creating an article.
Original image bytes and metadata are preserved; validation is not sanitization.

Registration, login, article creation/editing/deletion, and logout require a
session-bound CSRF token. Logout uses a POST form, so visiting a link cannot log you out. Tokens
expire after one hour; if form verification fails, refresh the original page
before trying again. The server returns HTTP 400 without performing the action.

Comment posting also requires authentication and CSRF verification. Rate limiting
and comment moderation are not implemented yet and need attention before public hosting.

Dependency upgrades, image metadata sanitization,
and durable image storage remain work to complete before deployment. The Flask
development server is for local use only.

---

## 🎓 Project Context

Hummingbird is being extended for a university module on relational databases:

- Relational modelling and normalization
- SQL, joins, aggregation, and query optimization
- Transactions, constraints, and concurrent access
- Database access through an ORM

The planned features above are not implemented yet. Dataset measurements,
query-plan evidence, and the remaining assessment documentation will be added
as the corresponding work is completed.

---

## 🤖 Use of AI Tools

AI tools support implementation, refactoring, testing, debugging, and documentation.
Some changes are implemented and tested by an AI coding agent, then reviewed by
the author. The author is responsible for understanding and explaining the
submitted implementation.

---

## 📬 Contact

E-mail: <tobias.aschenbrenner@code.berlin>

---

## 📄 License

[MIT](https://choosealicense.com/licenses/mit/)
