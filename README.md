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

### Verify installation

```bash
python -m pip check
FLASK_APP=run.py python -m flask routes
```

The first command checks dependency compatibility. The second confirms
that Flask can load the application; it does not verify the database
connection or create database tables.

## Usage

Visit [hummingbird](https://murmuring-bayou-90231.herokuapp.com/) to see the newest blog posts on the landing page. Filter for articles you like and read them. You can also create an account to write articles yourself.

## Contact

E-mail: <tobias.aschenbrenner@code.berlin>

## License

[MIT](https://choosealicense.com/licenses/mit/)
