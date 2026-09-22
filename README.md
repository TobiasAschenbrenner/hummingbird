# Hummingbird 🐦

Hummingbird is a blogging application built with Flask and PostgreSQL.
Readers can browse articles, and registered users can publish articles with cover images.

---

## ✨ Features

- Register, log in, and log out
- Publish articles with cover images
- Browse the newest articles with pagination
- Read individual articles
- Choose categories stored in the database
- Filter articles by category across all pages
- See the total number of articles in each category
- Responsive frontend

### Planned features

- Multiple tags per article and filtering by tag
- Editing and deleting your own articles
- Adding and deleting your own comments
- Article search

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

### Development

- Python's built-in unittest runner
- Ruff

---

## 📁 Project Structure

```text
hummingbird/
├── app/
│   ├── articles/      # Article models, queries, services, routes, and uploads
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
The homepage shows 12 articles per page, newest first. Category links filter in
the database before pagination, so they include matching articles from all pages.
The selected category stays active when moving between pages. Choose **All** to
clear the filter. These links also work without JavaScript.

The number beside each category counts all its articles, not just the current
page. Empty categories show zero. The counts come from one database query using
a left join, `COUNT`, and `GROUP BY`.

Cover images are stored in `app/static/images/uploads/`. The folder is created
when needed and its contents are ignored by Git. New files receive unique names.
Supported extensions are PNG, JPG/JPEG, GIF, and WebP.

---

## 📊 Demo Data

A new database has no users or articles. After applying migrations, run:

```bash
FLASK_APP=run.py python -m flask seed-demo
```

By default, this creates:

- One demo account: `demo@hummingbird.example`
- 18 sample articles across design, tech, and mobile

On the first run, choose the demo account's password at the hidden prompt.
Rerunning the command fills in missing samples without changing existing demo
articles or credentials. Use `--count 30` to request 30 sample articles in total.

Sample dates start on January 1, 2024. Articles use an image placeholder and
cycle through the categories currently stored in the database.
These are generated sample counts, not a report of your current database size.
The dataset is intended for development, not performance measurement.

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
query loading, category filtering and counts, rollback, image cleanup, repeatable seeding,
schema compatibility, and migration round trips.

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

CSRF protection, image-content validation, request limits, dependency upgrades,
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
