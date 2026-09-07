# hummingbird

Hummingbird is a small blogging application built with Flask, SQLAlchemy, and PostgreSQL. Readers can browse articles; registered users can publish articles with cover images.

## Installation

### Python environment

This project currently uses Python 3.10.21, recorded in `.python-version`.
With pyenv installed, run these commands from the repository root:

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

### Environment configuration

Copy the example configuration if you do not already have a `.env` file:

```bash
cp .env.example .env
```

Set `DATABASE_URL` to your PostgreSQL connection URL. Generate a secret:

```bash
python -c 'import secrets; print(secrets.token_hex(32))'
```

Paste the generated value into `SECRET_KEY` in `.env`.
Keep `.env` private; it is excluded from Git.

### Local PostgreSQL setup

PostgreSQL must be installed and running. For an existing Homebrew
PostgreSQL 14 installation on macOS:

```bash
brew services start postgresql@14
pg_isready -h localhost -p 5432
```

Create a dedicated application role and database once:

```bash
createuser -h localhost --pwprompt hummingbird
createdb -h localhost --owner=hummingbird hummingbird
```

These commands assume your local macOS user has PostgreSQL permission
to create roles and databases.

For the local development settings in `.env.example`, enter
`hummingbird` as the new role's password. If you choose different
credentials, update `DATABASE_URL` in `.env` accordingly.

Verify the application connection:

```bash
psql -h localhost -U hummingbird -d hummingbird \
  -c "SELECT current_database(), current_user;"
```

With the Python virtual environment activated and `.env` configured,
apply the committed migrations:

```bash
FLASK_APP=run.py python -m flask db upgrade
```

Verify the migration version and database tables:

```bash
FLASK_APP=run.py python -m flask db current
psql -h localhost -U hummingbird -d hummingbird -c '\dt'
```

On the initial schema, the tables are `users`, `articles`, and
`alembic_version`. The last table records the applied migration version.

### Verify installation

```bash
python -m pip check
FLASK_APP=run.py python -m flask routes
```

The first command checks dependency compatibility. The second confirms
that Flask can load the application; it does not verify the database
connection or create database tables.

### Run locally

From the repository root, activate the virtual environment and start
the development server:

```bash
source venv/bin/activate
FLASK_APP=run.py python -m flask run --port 5001
```

Open http://127.0.0.1:5001 in your browser.

Keep the terminal running while using the application.
Press Ctrl+C to stop the server.

A newly created database contains no users or articles.

## Usage

Open [the local application](http://127.0.0.1:5001), then use **Log in**
to register or sign in. Choose **New Article** to publish an article.
The homepage lists the newest articles first with 12 articles per page.
Category buttons filter only the articles on the current page.

Cover images are stored in `app/static/images/uploads/`. The directory
is created automatically, and uploaded files are ignored by Git.
New uploads receive unique filenames. Supported extensions are PNG,
JPG/JPEG, GIF, and WebP. Existing image filenames remain valid.

The development server does not reload automatically with the command
above: save your changes and restart it. For local development only,
you can enable Flask's reloader with:

```bash
FLASK_APP=run.py FLASK_ENV=development python -m flask run --port 5001
```

## Optional demo data

After applying migrations, add sample data to your configured development database:

```bash
FLASK_APP=run.py python -m flask seed-demo
```

This creates the account `demo@hummingbird.example` and 18 sample articles.
On the first run, you choose its password at a hidden prompt. Existing
demo credentials and articles are reused without modification.
Running the command again fills in missing samples without duplicating them.
Use `--count 30` to request 30 sample articles in total.

Sample dates begin on January 1, 2024; categories rotate through design,
tech, and mobile. Samples use a visual placeholder instead of an uploaded
image. This is a small development dataset, not a performance benchmark.

## Tests

Tests use Python's built-in `unittest` and a separate PostgreSQL database.
Create that database once:

```bash
createdb -h localhost --owner=hummingbird hummingbird_test
```

Activate the virtual environment, then run:

```bash
TEST_DATABASE_URL=postgresql://hummingbird:hummingbird@localhost:5432/hummingbird_test \
  python -m unittest discover -v
```

Adjust the credentials if your local role uses a different password.
The integration tests apply the existing migrations and reset `users` and
`articles` in this database between tests. Use a disposable test database;
its name must end in `_test`. Upload tests use temporary directories.
Without `TEST_DATABASE_URL`, the database tests are skipped, so a passing
run without it is not full verification.

The suite covers authentication, article creation and pagination,
validation, author loading, rollback, upload cleanup, demo seeding, and
compatibility with the committed database schema.

## Code checks

Optional development tools are separate from application dependencies:

```bash
python -m pip install -r requirements-dev.txt
ruff check app tests run.py migrations/env.py
ruff format --check app tests run.py migrations/env.py
```

Use `ruff format app tests run.py migrations/env.py` to apply formatting.
Keep historical migration files unchanged.

## Project structure

Read [the code structure and cleanup notes](docs/code-structure.md) for
file responsibilities, request flow, compatibility details, and the
remaining database work.

## Contact

E-mail: <tobias.aschenbrenner@code.berlin>

## License

[MIT](https://choosealicense.com/licenses/mit/)
