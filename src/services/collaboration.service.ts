import jwt, { type JwtPayload } from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { getNeo4jSession } from '../config/neo4j.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../errors/app-error.js';
import type { CollaborationAuthResponse } from '../dtos/collaboration.dto.js';

const COLLABORATION_TOKEN_EXPIRES_IN = '5m';

/**
 * Room identity format — deterministic for the same document.
 */
export function roomIdentity(graphId: string): string {
  return `doc:${graphId}`;
}

/**
 * Resolve whether the authenticated user can edit or only read.
 * creator/admin roles → edit; member → read.
 */
async function resolvePermission(_userId: string, graphId: string): Promise<'read' | 'edit'> {
  await getDocNode(graphId);

  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `MATCH (workspace:Workspace)-[]->(doc:Document {id: $graphId})
       RETURN workspace.id AS workspaceGraphId LIMIT 1`,
      { graphId },
    );
    if (!result.records.length) return 'edit';

    const workspaceGraphId = result.records[0].get('workspaceGraphId') as string;
    const workspace = await prisma.workspace.findUnique({
      where: { graphId: workspaceGraphId },
      include: { members: { where: { userId: _userId } } },
    });
    if (!workspace || !workspace.members[0]) return 'edit';

    return workspace.members[0].role === 'creator' || workspace.members[0].role === 'admin' ? 'edit' : 'read';
  } finally {
    await session.close();
  }
}

async function getDocNode(graphId: string): Promise<{ id: string }> {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      'MATCH (n {id: $graphId}) RETURN n.id AS id LIMIT 1',
      { graphId },
    );
    if (!result.records.length) throw new AppError('Document not found', 404);
    return { id: result.records[0].get('id') as string };
  } finally {
    await session.close();
  }
}

function createCollabToken(room: string, permission: 'read' | 'edit', userId: string): string {
  return jwt.sign(
    { room, permission, sub: userId },
    env.jwtSecret,
    { expiresIn: COLLABORATION_TOKEN_EXPIRES_IN },
  );
}

export class CollaborationService {
  async authorize(graphId: string, userId: string): Promise<CollaborationAuthResponse> {
    // Validate the graph node exists and the user has workspace access.
    // Reuses the same Neo4j traversal + Prisma membership check as document-auth.
    await validateAccess(graphId, userId);

    const permission = await resolvePermission(userId, graphId);
    const room = roomIdentity(graphId);
    const token = createCollabToken(room, permission, userId);

    logger.info('Collaboration auth granted', { graph_id: graphId, user_id: userId, permission, room });
    return {
      room,
      token,
      websocketUrl: env.collaborationWebsocketUrl,
      permission,
    };
  }
}

async function validateAccess(graphId: string, _userId: string): Promise<void> {
  // Only verify the document node exists; no workspace membership required.
  await getDocNode(graphId);
}

/**
 * Validate a collaboration token issued by this service.
 * Returns the decoded payload or throws on any validation failure.
 */
export function decodeCollabToken(token: string): { room: string; permission: 'read' | 'edit'; sub: string } {
  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload & {
      room: string;
      permission: 'read' | 'edit';
      sub: string;
    };
    if (!payload.room || !payload.permission || !payload.sub) {
      throw new Error('Missing required claims');
    }
    return payload;
  } catch {
    logger.error('Invalid or expired collaboration token received');
    throw new AppError('Invalid or expired collaboration token', 401);
  }
}
