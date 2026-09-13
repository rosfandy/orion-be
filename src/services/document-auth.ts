import { getNeo4jSession } from '../config/neo4j.js';
import { prisma } from '../config/database.js';
import { AppError } from '../errors/app-error.js';

export async function validateDocumentAccess(graphId: string, userId: string): Promise<{ workspaceId: string }> {
  // 1. Validate Neo4j node exists
  const docNode = await getDocNode(graphId);

  // 2. Resolve parent workspace and validate access
  const workspaceId = await resolveWorkspaceId(docNode);
  await requireWorkspaceAccess(userId, workspaceId);

  return { workspaceId };
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

async function resolveWorkspaceId(docNode: { id: string }): Promise<string> {
  const session = getNeo4jSession();
  try {
    const result = await session.run(
      `MATCH (workspace:Workspace)-[]->(doc:Document {id: $graphId})
       RETURN workspace.id AS workspaceGraphId LIMIT 1`,
      { graphId: docNode.id },
    );
    if (!result.records.length) {
      throw new AppError('Document has no parent workspace', 404);
    }
    const workspaceGraphId = result.records[0].get('workspaceGraphId') as string;

    const workspace = await prisma.workspace.findUnique({
      where: { graphId: workspaceGraphId },
      select: { id: true },
    });
    if (!workspace) throw new AppError('Parent workspace not found in database', 404);
    return workspace.id;
  } finally {
    await session.close();
  }
}

async function requireWorkspaceAccess(userId: string, workspaceId: string): Promise<void> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  if (!membership) throw new AppError('Access denied', 403);
}
