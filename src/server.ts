import app from "./app.js";
import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { closeNeo4j, initNeo4j } from "./config/neo4j.js";

async function startServer(): Promise<void> {
  try {
    await initNeo4j();
    logger.info("Neo4j connection verified");

    const server = app.listen(env.port, () => {
      logger.info(`API running on http://localhost:${env.port}`);
    });

    const shutdown = async (): Promise<void> => {
      server.close(async () => {
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
