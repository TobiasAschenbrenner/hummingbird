# Hummingbird 🐦

Hummingbird is a blogging application built with Angular, Express and PostgreSQL.
Readers can browse articles, while registered users can publish posts and join the discussion.

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

- **Frontend:** Angular, TypeScript and SCSS
- **Backend:** Node.js, Express and TypeScript
- **Database:** PostgreSQL and Prisma ORM
- **Images:** Cloudinary

---

## 📁 Project Structure

```text
hummingbird/
├── client/            # Angular frontend
├── server/            # Express API, Prisma migrations and database tests
└── postman/           # API request collections
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 24 (24.12.0 or newer) and npm; use nvm with the included `.nvmrc`
- A running PostgreSQL server
- Cloudinary credentials for optional cover uploads

Run these commands from the repository root:

```bash
nvm install
nvm use
npm ci --prefix server
npm ci --prefix client
```

---

## 🔧 Environment Variables

For a fresh setup, copy the server example and fill in your local credentials:

```bash
cp server/.env.example server/.env
```

| Variable                                                               | Purpose                                                  |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `DATABASE_URL`                                                         | Development database                                     |
| `SHADOW_DATABASE_URL`                                                  | Separate disposable database for creating migrations     |
| `TEST_DATABASE_URL`                                                    | Separate disposable database ending in `_test`           |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Optional cover uploads; leave all three blank to disable |

The API defaults to port `3000` in development. Keep `server/.env` private;
it is ignored by Git. The frontend connects through `/api` and contains no secrets.

---

## 🗄️ Database Setup

Create the local role and three databases using the [server setup](server/README.md#-postgresql-setup),
then apply migrations and add the default categories:

```bash
cd server
npm run db:deploy
npm run db:seed
```

Optional: run `npm run db:seed:demo` for sample articles, tags and comments.
Demo authors cannot sign in; register your own account.

---

## ▶️ Running the Application

Start the API from the repository root:

```bash
cd server
npm run dev
```

In another terminal, starting at the repository root:

```bash
cd client
npm start
```

Open [Hummingbird](http://127.0.0.1:4200). Use Ctrl+C in each terminal to stop.
More details: [client setup](client/README.md) · [server setup](server/README.md).

---

## 🧪 Tests and Quality Checks

Run from the repository root:

```bash
npm run check --prefix client
npm run check --prefix server
npm run test:db --prefix server
```

Database tests erase their disposable `_test` database. Keep it separate from development.
Import the [Postman collections](postman/) to test the API manually.

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
