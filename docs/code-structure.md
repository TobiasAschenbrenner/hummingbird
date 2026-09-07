# Code structure and cleanup notes

This cleanup provides a working baseline for the relational database module.
It does not implement the planned expanded schema or make the project hand-in ready.

## Where to work

```text
app/
  __init__.py          Application factory; registers extensions, routes, commands
  config.py            Loads and validates configuration; accepts test overrides
  extensions.py        Shared SQLAlchemy, migration, and login-manager instances
  errors.py            Expected input errors that can be shown to users
  articles/
    models.py          Article mapping and current field limits/categories
    queries.py         Read queries, author loading, ordering, pagination
    services.py        Article validation, creation, commit and rollback
    uploads.py         Local image storage and failure cleanup
    routes.py          Article HTTP handlers and template responses
  users/
    models.py          User mapping and relationship to authored articles
    services.py        Registration and password verification
    routes.py          Login, registration, logout, safe return destinations
  commands/
    seed.py            Explicit, repeatable development-data command
  templates/
    base.html          Shared page layout
    partials/          Header, footer, and messages
    users/             Authentication dialog
    articles/          Homepage, article detail, and creation form
  static/
    css/               Shared, authentication, and article styles
    js/                Authentication dialog and current-page filtering
    images/            Favicon and ignored uploaded images
tests/
  test_application.py  PostgreSQL integration tests for application behavior
  test_config.py       Configuration validation
  test_uploads.py      File storage and cleanup tests
migrations/            Existing Alembic migration history
run.py                 Development and Gunicorn entry point
```

Small related functions share a module. Routes handle requests and responses;
services perform application operations; queries retrieve data; models describe
the schema. File storage is isolated so a future Cloudinary integration has a
clear place to start. There is no generic repository abstraction around SQLAlchemy.

## Creating an article

1. `articles.routes.submit_article` requires a logged-in user and reads the form.
2. `articles.services.create_article` validates fields and checks the proposed slug.
3. `articles.uploads.save_image` validates the extension and stores the image under a generated name.
4. The service adds the article and commits once. On a database failure, it rolls
   back and removes the new file. The database unique constraint also handles a
   duplicate slug that appears after the initial check.
5. The route redirects to the homepage. Refreshing it does not repeat the POST.

Expected validation errors appear in the form, with entered text preserved.
Browsers require users to reselect a file after an unsuccessful submission.
Database or filesystem errors are logged and shown as generic messages.
Cleanup exceptions are logged without hiding the original failure.

File writes and database commits are not one atomic resource. Cleanup handles
ordinary failures, but a process crash or ambiguous connection failure during
commit can still require reconciliation. Extension checks do not decode or
verify actual image contents.

## Database compatibility

No migration or database reset is needed for this cleanup. Physical table names,
column names, column types, constraints, and existing indexes are unchanged.
The initial migration remains `b5c595757bd0`.

| Python name | Existing database name |
| --- | --- |
| `User` | `users` |
| `User.password_hash` | `users.password` |
| `Article` | `articles` |
| `Article.body` | `articles.text` |
| `Article.image_filename` | `articles.img_url` |

`User.articles` and `Article.author` describe the two directions of the existing
foreign-key relationship. Explicit table/column mappings preserve compatibility.
Read queries load authors alongside articles instead of retrieving all users
and matching them in templates. Models no longer commit implicitly.

## Routes and visible changes

| Method | URL | Purpose |
| --- | --- | --- |
| GET | `/` | Paginated article listing |
| GET | `/<slug>` | Read an article |
| GET | `/new-post` | Article form, login required |
| POST | `/new-post` | Create an article, login required |
| POST | `/auth/login` | Authenticate |
| POST | `/auth/register` | Register |
| GET | `/logout` | End the session |

The forms now post to explicit authentication endpoints rather than overloading
the homepage and every article URL. Existing public article URLs remain valid.
New titles produce URL-safe slugs; existing slugs are not regenerated. Duplicate
or reserved slugs are rejected with a useful message. Registration keeps the
existing email case-sensitivity behavior.

Shared templates use `url_for`, unique form IDs, labels, and consistent names.
The authentication UI uses a native dialog and small JavaScript modules, so
jQuery is no longer loaded. The placeholder article share controls, which only
linked to platform homepages, were removed; the footer platform links remain.
The application retains its existing visual style. Article text preserves line
breaks, and the article layout accommodates long titles without overlap.

## Verification

Follow the README to run the PostgreSQL integration suite and code checks.
The schema test compares SQLAlchemy metadata to the migrated PostgreSQL database,
including types and defaults. Upload tests cover generated names, extension handling,
filename collisions, partial writes, and cleanup after failed inserts.

Also check the homepage, authentication dialog, new article form, uploaded image,
category buttons, article detail, and logout in a browser after frontend changes.

## Next database work

- Agree the use cases and ER model before adding tables.
- Add categories, tags, the article/tag association, and comments as planned.
- Strengthen database constraints through new incremental migrations.
- Expand queries, server-side filtering, transactions, and performance evidence.
- Replace the small demo seed with a reproducible benchmark dataset when needed.
- Prepare the required design documentation and oral assessment examples.

Before deployment, plan runtime/dependency upgrades, CSRF protection, stronger
image-content validation and request limits, and durable image storage separately.
Logout still uses the existing GET route; changing it belongs with CSRF/form work.
The currently pinned Python and runtime dependencies were retained for this refactor.
