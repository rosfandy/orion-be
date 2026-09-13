import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { closeNeo4j, initNeo4j } from "./config/neo4j.js";
import { mountCollaboration } from "./server/collaboration.server.js";

async function startServer(): Promise<void> {
  try {
    await initNeo4j();
    logger.info("Neo4j connection verified");

    // Single HTTP server hosts both Express routes and the collaboration WS upgrade.
    const httpServer = app.listen(env.port, () => {
      logger.info(`API running on http://localhost:${env.port}`);
      logger.info(`Collaboration WS available at ws://localhost:${env.port}/collaboration`);
    });

    mountCollaboration(httpServer);

    const shutdown = async (): Promise<void> => {
      httpServer.close(async () => {
        await closeNeo4j();
        process.exit(0);
      });
    };

    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  } catch (error) {
    logger.error("Failed to initialize Neo4j", error);
    await closeNeo4j();
    process.exitCode = 1;
  }
}

void startServer();
