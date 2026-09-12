import neo4j, { type Driver, type Session } from 'neo4j-driver';
import { env } from './env.js';

export const neo4jDriver: Driver = neo4j.driver(
  env.neo4jUri,
  neo4j.auth.basic(env.neo4jUsername, env.neo4jPassword),
);

export function getNeo4jSession(): Session {
  return neo4jDriver.session();
}

export async function initNeo4j(): Promise<void> {
  await neo4jDriver.verifyConnectivity();

  const session = getNeo4jSession();
  try {
    await session.run('RETURN 1 AS connected');
  } finally {
    await session.close();
  }
}

export async function closeNeo4j(): Promise<void> {
  await neo4jDriver.close();
}
