# hummingbird

hummingbird is a significantly reduced knock-off version of Medium. The application is a simple website that allows anyone to write a blog post for free and publish it. Other users of the website can then read the blog post.

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

Visit [hummingbird](https://murmuring-bayou-90231.herokuapp.com/) to see the newest blog posts on the landing page. Filter for articles you like and read them. You can also create an account to write articles yourself.

## Contact

E-mail: <tobias.aschenbrenner@code.berlin>

## License

[MIT](https://choosealicense.com/licenses/mit/)
