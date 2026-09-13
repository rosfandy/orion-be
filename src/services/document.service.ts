import { getNeo4jSession } from '../config/neo4j.js';
import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { AppError } from '../errors/app-error.js';
import type { LoadDocumentResponse, SaveDocumentDto } from '../dtos/document.dto.js';

type DbRow = {
  id: string;
  graphId: string;
  content: unknown;
  plainText: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  yjsState: Uint8Array<ArrayBuffer> | null;
  workspaceGraphId: string | null;
};

export class DocumentService {
  /**
   * Load current document state by graph ID.
   */
  async load(graphId: string, userId: string): Promise<LoadDocumentResponse> {
    const docNode = await this.getDocNode(graphId);
    if (!docNode) throw new AppError('Document not found', 404);

    const { workspaceId } = await this.resolveWorkspace(docNode);
    await this.requireWorkspaceAccess(userId, workspaceId);

    const row = await prisma.document.findUnique({ where: { graphId } });
    if (!row) {
      // Auto-create empty row on first load so the first save finds a valid baseVersion.
      const created = await prisma.document.create({
        data: {
          graphId,
          content: {} as never,
          plainText: '',
          version: 0,
          workspaceGraphId: null,
        },
      });
      logger.info('Auto-created empty document row', { graph_id: graphId });
      return this.toResponse(created as DbRow);
    }
    return this.toResponse(row as DbRow);
  }

  /**
   * Save current document content with stale-write guard.
   * Also updates workspace_graph_id and search_vector for FTS.
   */
  async save(graphId: string, userId: string, input: unknown): Promise<LoadDocumentResponse> {
    const data = input as Partial<SaveDocumentDto>;
    const baseVersion = typeof data.baseVersion === 'number' ? data.baseVersion : undefined;
    if (baseVersion === undefined) throw new AppError('baseVersion is required', 400);

    const docNode = await this.getDocNode(graphId);
    if (!docNode) throw new AppError('Document not found', 404);

    const { workspaceId, workspaceGraphId } = await this.resolveWorkspace(docNode);
    await this.requireWorkspaceAccess(userId, workspaceId);

    const row = await prisma.document.findUnique({ where: { graphId } }) as DbRow | null;
    const currentVersion = row?.version ?? 0;

    if (row !== null && baseVersion !== currentVersion) {
      logger.error('Stale write rejected', { graph_id: graphId, base_version: baseVersion, current_version: currentVersion });
      throw new AppError('Document was modified by another session. Refresh and retry.', 409);
    }

    const content = data.content !== undefined ? data.content : (row?.content ?? {});
    const plainText = data.plainText !== undefined
      ? (data.plainText ?? '')
      : (row?.plainText ?? '');
    const yjsState = data.yjsState !== undefined && data.yjsState !== null
      ? (Buffer.from(data.yjsState, 'base64') as never)
      : (row?.yjsState ?? null);

    // ponytail: move tsvector refresh into a DB trigger when migration tooling supports it.
    // For now, application-side update keeps FTS in sync with plain_text + workspace_graph_id.
    const saved = await prisma.$transaction(async (tx) => {
      const doc = await tx.document.upsert({
        where: { graphId },
        create: {
          graphId,
          content: content as never,
          plainText,
          yjsState: yjsState as never,
          version: 1,
          workspaceGraphId,
        },
        update: {
          content: content as never,
          plainText,
          yjsState: yjsState as never,
          version: { increment: 1 },
          workspaceGraphId,
        },
      });
      await tx.$executeRaw`
        UPDATE documents
        SET search_vector = to_tsvector('english', plain_text),
            workspace_graph_id = ${workspaceGraphId}::text
        WHERE graph_id = ${graphId}
      `;
      return doc;
    });
    logger.info('Document saved', { graph_id: graphId, version: saved.version });
    return this.toResponse(saved as DbRow);
  }

  private toResponse(row: DbRow): LoadDocumentResponse {
    return {
      graph_id: row.graphId,
      content: (row.content ?? {}) as Record<string, unknown>,
      plain_text: row.plainText,
      version: row.version,
      has_content: row.version > 0,
    };
  }

  private async getDocNode(graphId: string): Promise<{ id: string }> {
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

  private async resolveWorkspace(docNode: { id: string }): Promise<{ workspaceId: string; workspaceGraphId: string }> {
    const session = getNeo4jSession();
    try {
      const result = await session.run(
        `MATCH (workspace:Workspace)-[]->(doc:Document {id: $graphId})
         RETURN workspace.id AS workspaceGraphId LIMIT 1`,
        { graphId: docNode.id },
      );
      if (!result.records.length) {
        // No parent workspace — return empty. Document can still be read/written.
        return { workspaceId: '', workspaceGraphId: '' };
      }
      const workspaceGraphId = result.records[0].get('workspaceGraphId') as string;
      const workspace = await prisma.workspace.findUnique({
        where: { graphId: workspaceGraphId },
        select: { id: true },
      });
      if (!workspace) return { workspaceId: '', workspaceGraphId: '' };
      return { workspaceId: workspace.id, workspaceGraphId };
    } finally {
      await session.close();
    }
  }

  private async requireWorkspaceAccess(userId: string, workspaceId: string): Promise<void> {
    if (!workspaceId) return; // no workspace = skip access check
    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId, userId } },
    });
    if (!membership) throw new AppError('Access denied', 403);
  }
}
