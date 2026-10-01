# Hummingbird 🐦

Hummingbird is a blogging application built with Flask and PostgreSQL.
Readers can browse articles, while registered users can publish posts and join the discussion.

> **Rewrite in progress:** The Angular/Express replacement is being built on
> `rewrite/angular-express`. See [client setup](client/README.md) and
> [server setup](server/README.md) to run the Angular status page and Express API.
> The database and registration API are ready; login and blog features come next. The Flask
> instructions below remain valid; its baseline is tagged `flask-baseline`.

---

## ✨ Features

- Register, log in, and log out
- Create, edit, and delete your own articles with cover images
- Organize articles with categories and tags
- Search and filter articles with pagination
- Post comments and delete your own comments
- Responsive frontend

---

## 🛠 Tech Stack

- **Frontend:** HTML, CSS, JavaScript, and Jinja templates
- **Backend:** Python and Flask
- **Database:** PostgreSQL, SQLAlchemy, and Flask-Migrate

---

## 📁 Project Structure

```text
hummingbird/
├── client/            # Angular rewrite
├── server/            # Express rewrite
├── postman/           # API request collection
├── app/               # Existing Flask application
├── migrations/        # Database migrations
├── tests/             # Automated tests
└── run.py             # Application entry point
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.10.21 and pyenv
- A running PostgreSQL server

Run these commands from the repository root:

```bash
pyenv install -s 3.10.21
pyenv local 3.10.21
pyenv exec python -m venv venv
source venv/bin/activate
python -m pip install -r requirements.txt
```

Activate the environment with `source venv/bin/activate` in each new terminal.

---

## 🔧 Environment Variables

If you do not have a `.env` file yet, create it from the example:

```bash
cp .env.example .env
```

```dotenv
DATABASE_URL=postgresql://hummingbird:hummingbird@localhost:5432/hummingbird
SECRET_KEY=replace-with-a-generated-secret
```

Update `DATABASE_URL` to match your local database credentials. Generate a secret
and paste it into `SECRET_KEY`:

```bash
python -c 'import secrets; print(secrets.token_hex(32))'
```

The example credentials are for local development only. Keep `.env` private;
it is ignored by Git.

---

## 🗄️ Database Setup

Create the role and database once, using a PostgreSQL account with permission
to create them. Choose the password configured in `.env`:

```bash
createuser -h localhost --pwprompt hummingbird
createdb -h localhost --owner=hummingbird hummingbird
```

With the virtual environment active and `.env` configured, apply the migrations:

```bash
FLASK_APP=run.py python -m flask db upgrade
```

Run this again when new migrations are added. Back up existing data before upgrading.

---

## ▶️ Running the Application

```bash
FLASK_APP=run.py python -m flask run --port 5001
```

Open [http://127.0.0.1:5001](http://127.0.0.1:5001).
Use Ctrl+C to stop the local development server; restart it after code changes.

Uploaded images are stored locally in `app/static/images/uploads/`, which is ignored by Git.

---

## 🧪 Tests and Quality Checks

Create a separate test database once:

```bash
createdb -h localhost --owner=hummingbird hummingbird_test
```

Run the tests from the repository root with the virtual environment active.
Adjust the example credentials to match your database:

```bash
TEST_DATABASE_URL=postgresql://hummingbird:hummingbird@localhost:5432/hummingbird_test \
  python -m unittest discover -v
```

> [!WARNING]
> Tests reset data in the test database. Use a disposable database whose name
> ends in `_test`. Without `TEST_DATABASE_URL`, database tests are skipped.

For lint and formatting checks:

```bash
python -m pip install -r requirements-dev.txt
ruff check app tests run.py migrations/env.py
ruff format --check app tests run.py migrations/env.py
```

---

## 🗂️ Data Model

---

## 📊 Data

---

## 🎓 Project Context

Hummingbird was built as a university project to learn basic web technologies
and is being extended to explore relational database design and development.

---

## 🤖 Use of AI Tools

AI tools support implementation, refactoring, testing, debugging, and documentation.
The author is responsible for reviewing the code and understanding the submitted work.
