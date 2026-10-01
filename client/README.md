# Hummingbird client 🐦

Angular frontend for the rewrite, with registration, login, logout and an API
connection check. Blog features come next.

## 🚀 Run locally

Use Node.js 24 (24.12.0 or newer). Configure PostgreSQL and apply migrations using
the [server setup](../server/README.md), then start the API from the repository root:

```bash
cd server
npm ci
npm run dev
```

In another terminal, starting again at the repository root:

```bash
cd client
npm ci
npm start
```

Open [Hummingbird](http://127.0.0.1:4200). You should see **API connected**.
If the API is stopped, the page shows an error and lets you check again.
Use Ctrl+C in each terminal to stop the servers.

## 👤 Accounts

- **Register:** `/register` creates an account, then opens the login page.
- **Log in:** `/login` signs in and returns home.
- **Log out:** Use the header button to revoke the current session.

Passwords use 15–128 characters; spaces and Unicode are preserved. Forms show
validation errors and failed-request messages, and prevent duplicate submissions.
Demo seed accounts cannot sign in; register your own account.

The app restores your session on refresh through `/api/auth/me`. Cookies stay
HTTP-only; passwords and session tokens are never saved in browser storage.
The backend remains responsible for authentication and session expiry.

## 📁 Structure

- `src/app/pages/`: routed pages
- `src/app/components/`: reusable interface elements
- `src/app/services/`: API communication
- `src/app/models/`: API response types
- `src/app/validators/`: shared form validation

Components keep their HTML, SCSS and tests together, as in Chirp.

## 🔧 API connection

Requests use `/api`. During development, `proxy.conf.json` forwards them to
`http://127.0.0.1:3000`. If you change the API port, update the proxy target and
restart Angular. Account requests include cookies; login and logout send the
API's required `X-Hummingbird-Request` header. Never put database credentials or
API secrets in frontend files.

The development proxy is not part of a production build. Hosting will need to
route `/api` to Express and serve `index.html` for frontend routes.

## 🧪 Checks

```bash
npm run check
```

This runs the Angular tests, checks formatting and builds the production bundle
in `dist/hummingbird-client/browser/`. The build also checks TypeScript and templates.
Tests cover forms, navigation, session restoration, logout and request failures.
They simulate HTTP responses and do not need a running API or database.

Use `npm run test:watch` while developing.
