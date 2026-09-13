/**
 * Server entrypoint.
 *
 * EXPORTS the fully-wired http.Server so Vercel (zero-config Express backend /
 * WebSocket-capable functions) can attach HTTP + WebSocket upgrades to it.
 * Vercel picks up the default export — do NOT call listen() here in
 * production, Vercel binds the port and delivers upgrades itself.
 *
 * For local dev / legacy process mode, run src/dev.ts which calls listen()
 * on this same exported server.
 */
import http from 'node:http';
import app from './app.js';
import { logger } from './config/logger.js';
import { closeNeo4j, initNeo4j } from './config/neo4j.js';
import { mountCollaboration } from './server/collaboration.server.js';

// Single HTTP server hosts both Express routes and the collaboration WS upgrade.
export const server = http.createServer(app);
mountCollaboration(server);

// Warm Neo4j in the background — the driver connects lazily per session,
// so requests are not blocked on the connectivity check.
void initNeo4j()
  .then(() => logger.info('Neo4j connection verified'))
  .catch((err) => logger.error('Neo4j connectivity check failed', err));

export default server;