# Hummingbird API 🐦

Express and TypeScript foundation for the rewrite. It currently provides only a
health endpoint; authentication, database access and Angular come in later commits.

## 🚀 Getting started

Use Node.js 24 (24.12.0 or newer). From the repository root:

```bash
nvm install
nvm use
cd server
npm ci
npm run dev
```

Open [the health endpoint](http://127.0.0.1:3000/api/health). It returns
`{"status":"ok"}`. This checks that the API is running, not database availability.
The server currently listens only on your own computer (`127.0.0.1`).

## 🔧 Configuration

Defaults work without an environment file. To customize them, copy `.env.example`
to `.env` inside `server/`, unless you already have that file.

| Variable   | Default       | Allowed values                      |
| ---------- | ------------- | ----------------------------------- |
| `PORT`     | `3000`        | Whole number from 1 to 65535        |
| `NODE_ENV` | `development` | `development`, `test`, `production` |

Run the scripts from `server/`. They load only its optional `.env`; the Flask
configuration at the repository root is separate. Environment files stay out of Git.

## 🧪 Checks and Postman

```bash
npm run check
```

This checks types, runs HTTP/configuration tests, checks formatting and builds the
application. Tests use a temporary local port and do not need a database.

Import [the Postman collection](../postman/hummingbird.postman_collection.json).
Its `baseUrl` defaults to `http://127.0.0.1:3000`; change it if you use another port.

To run the compiled application, stop the development server first:

```bash
npm run build
npm start
```

Use Ctrl+C to stop either server. Compiled files and installed dependencies are
ignored by Git.
