import { createApp } from './app.ts';
import { readConfig } from './config/environment.ts';
import { createDatabaseClient } from './database/client.ts';
import { createArticleQueries } from './queries/article.queries.ts';
import { createSessionQueries } from './queries/session.queries.ts';
import { createUserQueries } from './queries/user.queries.ts';
import { createAuthenticationService } from './services/authentication.service.ts';
import { createRegistrationService } from './services/registration.service.ts';

const config = readConfig();
const database = createDatabaseClient();
const users = createUserQueries(database);
const registerUser = createRegistrationService(users);
const authentication = createAuthenticationService(users, createSessionQueries(database));
const server = createApp({
  articles: createArticleQueries(database),
  registerUser,
  authentication,
  secureCookies: config.nodeEnv === 'production',
}).listen(config.port, '127.0.0.1', () => {
  console.log(`Hummingbird API listening at http://127.0.0.1:${config.port}`);
});

server.on('error', () => {
  console.error('Unable to start the API. Check the configured port.');
  process.exitCode = 1;
  void disconnectDatabase();
});

async function disconnectDatabase() {
  try {
    await database.$disconnect();
  } catch {
    console.error('Unable to close the database connection.');
    process.exitCode = 1;
  }
}

let shuttingDown = false;
function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeout = setTimeout(() => server.closeAllConnections(), 10_000);
  timeout.unref();
  server.close(() => {
    clearTimeout(timeout);
    void disconnectDatabase();
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
