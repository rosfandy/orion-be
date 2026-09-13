/**
 * Local development / legacy process-mode launcher.
 *
 * Vercel does not use this file — production imports the default export from
 * src/server.ts. Running this file starts the exported server on env.port
 * the same way the old app.listen() entrypoint did.
 */
import { server } from './server.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { closeNeo4j } from './config/neo4j.js';

server.listen(env.port, () => {
  logger.info(`API running on http://localhost:${env.port}`);
  logger.info(`Collaboration WS available at ws://localhost:${env.port}/collaboration`);
});

const shutdown = async (): Promise<void> => {
  server.close(async () => {
    await closeNeo4j();
    process.exit(0);
  });
};

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);