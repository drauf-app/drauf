import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectDatabase, runMigrations } from './db/index.js';
import { seedDefaultHousehold } from './db/seed.js';

const config = loadConfig();
const database = connectDatabase(config.database);
const app = buildApp(config);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    void app
      .close()
      .then(() => database.close())
      .then(() => process.exit(0));
  });
}

try {
  app.log.info({ dialect: config.database.dialect }, 'running database migrations');
  await runMigrations(database);
  await seedDefaultHousehold(database);
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
