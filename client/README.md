# Hummingbird client 🐦

Angular frontend for the rewrite, with accounts, article browsing and publishing.
Discussion comes later.

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

Open [Hummingbird](http://127.0.0.1:4200) to browse articles. An empty database
shows **No articles yet**; use the optional demo seed in the server setup for
sample posts. Failed requests show a retry button.
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

## 📚 Articles

- **Homepage:** newest articles first, 12 per page, with author, category, tags and comment counts.
- **Details:** `/articles/:slug` shows the full article and a link back to the list.
- **Write:** `/new-article` lets signed-in users publish with a category and up to 10 tags.

The list page stays in the URL (`/?page=2`) and is preserved when opening an
article and returning. Direct links and refreshes work. Dates are shown in UTC;
bodies are plain text with paragraph breaks, never trusted HTML.

The editor suggests an editable URL slug from the title. Run `npm run db:seed`
in `server/` if categories are empty; tags are optional. Publishing opens the new
article. Duplicate slugs, invalid fields and failed requests show clear messages.

Drafts stay only in the open editor; leaving or refreshing discards them. If your
session expires, log in in a new tab, then use **Check session** to keep writing.
After an uncertain publishing result, check the offered article URL before retrying;
the app never automatically repeats a publishing request.

Reading is public. Editing, deletion, search, filtering, comment bodies and cover
images are not implemented in the rewrite yet.

## 📁 Structure

- `src/app/pages/`: routed pages
- `src/app/components/`: reusable interface elements
- `src/app/services/`: API communication
- `src/app/models/`: API response types
- `src/app/validators/`: shared input validation

Components keep their HTML, SCSS and tests together, as in Chirp.

## 🔧 API connection

Requests use `/api`. During development, `proxy.conf.json` forwards them to
`http://127.0.0.1:3000`. If you change the API port, update the proxy target and
restart Angular. Account and publishing requests include cookies; login, logout
and publishing send the required `X-Hummingbird-Request` header. Never put database credentials or
API secrets in frontend files.

The development proxy is not part of a production build. Hosting will need to
route `/api` to Express and serve `index.html` for frontend routes.

## 🧪 Checks

```bash
npm run check
```

This runs the Angular tests, checks formatting and builds the production bundle
in `dist/hummingbird-client/browser/`. The build also checks TypeScript and templates.
Tests cover accounts, article reads and publishing, validation, catalog changes,
pagination, navigation, safe text rendering, failures and request cancellation.
They simulate HTTP responses and do not need a running API or database.

Use `npm run test:watch` while developing.
