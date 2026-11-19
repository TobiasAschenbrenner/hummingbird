# Hummingbird 🪽

Hummingbird is a blogging web application built with Angular, Express and PostgreSQL.\
It allows users to publish articles, browse posts and join discussions.

---

## 🌍 Live Demo

A live version of the application is available at:\
👉 [https://hummingbird.chirp.blog](https://hummingbird.chirp.blog)

---

## ✨ Features

- Register, log in and log out
- Create, edit and delete your own articles
- Organize articles with categories and tags
- Search and filter articles with pagination
- Comment on articles and delete your own comments
- Image uploads via Cloudinary
- Responsive frontend

---

## 🛠 Tech Stack

### Frontend

- Angular
- TypeScript
- SCSS
- RxJS
- Vitest

### Backend

- Node.js
- Express
- PostgreSQL (Prisma ORM)
- Cloudinary (image uploads)
- Node.js built-in test runner

---

## 📁 Project Structure

```bash
hummingbird/
├── client/                 # Angular frontend
├── server/                 # Express API, Prisma schema and seed script
├── docs/                   # Data model diagram
├── postman/                # API request collections
└── deploy/                 # Hostinger VPS configuration
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 24 (24.12.0 or newer)
- npm
- PostgreSQL server
- Cloudinary account (for image uploads)

---

## 🔧 Environment Variables

The backend requires a `.env` file inside the `server` folder.
This file is **ignored by Git** and must be created manually.

### `server/.env`

```bash
PORT=3000
NODE_ENV=development
TRUST_PROXY=0

DATABASE_URL=postgresql://hummingbird_rewrite:your_password@localhost:5432/hummingbird_rewrite
SHADOW_DATABASE_URL=postgresql://hummingbird_rewrite:your_password@localhost:5432/hummingbird_rewrite_shadow
TEST_DATABASE_URL=postgresql://hummingbird_rewrite:your_password@localhost:5432/hummingbird_rewrite_test

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret
```

---

## ▶️ Running the Application

### Backend

Create the local databases using the [PostgreSQL setup](server/README.md#-postgresql-setup).

```bash
cd server
npm install
npm run db:deploy
npm run db:seed
npm run dev
```

Backend runs on:
👉 [http://127.0.0.1:3000](http://127.0.0.1:3000)

---

### Frontend

```bash
cd client
npm install
npm start
```

Frontend runs on:
👉 [http://127.0.0.1:4200](http://127.0.0.1:4200)

---

## 🧪 Running Tests and Quality Checks

Backend tests and checks are executed from the `server` folder:

```bash
npm run check
npm run test:db
```

Frontend tests and checks are executed from the `client` folder:

```bash
npm run check
```

Database tests reset the dedicated `_test` database.

---

## Data Model

Hummingbird uses PostgreSQL tables for users, articles, categories, tags, comments and sessions. Foreign keys connect related records, with `article_tags` representing the many-to-many relationship between articles and tags.

<img width="1580" height="1130" alt="Hummingbird Data Model" src="docs/images/data-model.png" />

---

## 📊 Data

The database was populated using a custom **seed script** that creates synthetic demo data.

The generated dataset contains:

- 2 users
- 3 articles
- 3 categories
- 3 tags
- 5 article–tag links
- 2 comments

This dataset is used to demonstrate the relational data model and query patterns.

From the `server` directory, run:

```bash
npm run db:seed:demo
```

---

## 🎓 Project Context

This application was built as a **university project** to learn about:

- Basic web technologies and full-stack development
- Relational database design and SQL

---

## 🤖 Use of AI Tools

AI tools were used to support implementation, discuss architecture and refactoring options, understand errors and reason about relational database design. They also supported testing, deployment and project documentation. The author is responsible for reviewing the code and understanding the submitted work.
