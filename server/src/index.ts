import { createApp } from './app.ts';
import { readConfig } from './config/environment.ts';

const config = readConfig();
const server = createApp().listen(config.port, '127.0.0.1', () => {
  console.log(`Hummingbird API listening at http://127.0.0.1:${config.port}`);
});

server.on('error', (error) => {
  console.error(`Unable to start the API: ${error.message}`);
  process.exitCode = 1;
});
