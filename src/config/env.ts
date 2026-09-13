import 'dotenv/config';

const nodeEnv = process.env.NODE_ENV ?? 'development';
const jwtSecret = process.env.JWT_SECRET;

if (nodeEnv === 'production' && !jwtSecret) {
  throw new Error('JWT_SECRET must be configured in production');
}

export const env = {
  nodeEnv,
  port: Number(process.env.PORT ?? 3001),
  baseUrl: process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? 3001}`,
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  neo4jUri: process.env.NEO4J_URI ?? 'neo4j://localhost:7687',
  neo4jUsername: process.env.NEO4J_USERNAME ?? 'neo4j',
  neo4jPassword: process.env.NEO4J_PASSWORD ?? 'password',
  jwtSecret: jwtSecret ?? 'development-only-secret-change-me',
  collaborationWebsocketUrl: process.env.COLLABORATION_WEBSOCKET_URL ?? `ws://localhost:${process.env.PORT ?? 3001}/collaboration`,
};
