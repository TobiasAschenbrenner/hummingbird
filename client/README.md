# Hummingbird client 🐦

Angular frontend for the rewrite. This first version contains the shared layout,
routing and an API connection check. Blog features and database access come later.

## 🚀 Run locally

Use Node.js 24 (24.12.0 or newer). From the repository root, start the API:

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

## 📁 Structure

- `src/app/pages/`: routed pages
- `src/app/components/`: reusable interface elements
- `src/app/services/`: API communication
- `src/app/models/`: API response types

Components keep their HTML, SCSS and tests together, as in Chirp.

## 🔧 API connection

Requests use `/api`. During development, `proxy.conf.json` forwards them to
`http://127.0.0.1:3000`. If you change the API port, update the proxy target and
restart Angular. Never put database credentials or API secrets in frontend files.

The development proxy is not part of a production build. Hosting will need to
route `/api` to Express and serve `index.html` for frontend routes.

## 🧪 Checks

```bash
npm run check
```

This runs the Angular tests, checks formatting and builds the production bundle
in `dist/hummingbird-client/browser/`. The build also checks TypeScript and templates.
Tests simulate HTTP responses and do not need a running API or database.

Use `npm run test:watch` while developing.
