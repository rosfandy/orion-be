import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { AppError } from '../errors/app-error.js';
import { validateDocumentAccess } from './document-auth.js';
import type {
  AutomaticCheckpointResult,
  CreateManualSnapshotResponse,
  DocumentVersionDetailDto,
  DocumentVersionDto,
} from '../dtos/document-version.dto.js';

type DbRow = {
  id: string;
  graphId: string;
  sourceVersion: number;
  content: unknown;
  plainText: string;
  yjsState: Uint8Array<ArrayBuffer> | null;
  isManual: boolean;
  createdBy: string | null;
  createdAt: Date;
};

const MAX_HISTORY = 10;
const MAX_RETRIES = 3;

function toDto(row: DbRow): DocumentVersionDto {
  return {
    id: row.id,
    graph_id: row.graphId,
    source_version: row.sourceVersion,
    is_manual: row.isManual,
    created_by: row.createdBy,
    created_at: row.createdAt,
  };
}

function toDetailDto(row: DbRow): DocumentVersionDetailDto {
  const dto = toDto(row);
  return {
    ...dto,
    content: (row.content ?? {}) as Record<string, unknown>,
    plain_text: row.plainText,
    yjs_state: row.yjsState ? Buffer.from(row.yjsState).toString('base64') : null,
  };
}

export class DocumentVersionService {
  /**
   * List version metadata for a document, newest first, max 10.
   */
  async listVersions(graphId: string, userId: string): Promise<DocumentVersionDto[]> {
    await validateDocumentAccess(graphId, userId);
    const rows = await prisma.documentVersion.findMany({
      where: { graphId },
      orderBy: { createdAt: 'desc' },
      take: MAX_HISTORY,
    });
    return rows.map(toDto);
  }

  /**
   * Get full snapshot detail for a specific version.
   */
  async getVersion(graphId: string, userId: string, versionId: string): Promise<DocumentVersionDetailDto> {
    await validateDocumentAccess(graphId, userId);
    const row = await prisma.documentVersion.findUnique({ where: { id: versionId } });
    if (!row) throw new AppError('Version not found', 404);
    if ((row as DbRow).graphId !== graphId) throw new AppError('Version not found', 404);
    return toDetailDto(row as DbRow);
  }

  /**
   * Create a MANUAL snapshot from the current durable document state.
   * Throws 409 with message 'VERSION_HISTORY_FULL' when all 10 slots are manual.
   */
  async createManualSnapshot(graphId: string, userId: string): Promise<CreateManualSnapshotResponse> {
    return this.createSnapshotInternal(graphId, userId, true) as unknown as Promise<CreateManualSnapshotResponse>;
  }

  /**
   * Internal reusable operation for AUTOMATIC checkpoint creation.
   * Returns { skipped: true } when history is full with only manual snapshots.
   * Safe to call from autosave integration layers.
   */
  async createAutomaticCheckpoint(graphId: string): Promise<AutomaticCheckpointResult> {
    // No auth check here — called internally after auth has been performed upstream
    return this.createSnapshotInternal(graphId, null, false) as unknown as Promise<AutomaticCheckpointResult>;
  }

  /**
   * Explicitly delete a version snapshot. Manual snapshots can be deleted by any authorized user.
   */
  async deleteVersion(graphId: string, userId: string, versionId: string): Promise<void> {
    await validateDocumentAccess(graphId, userId);
    const row = await prisma.documentVersion.findUnique({
      where: { id: versionId },
      select: { id: true, graphId: true, isManual: true },
    });
    if (!row) throw new AppError('Version not found', 404);
    if (row.graphId !== graphId) throw new AppError('Version not found', 404);
    await prisma.documentVersion.delete({ where: { id: versionId } });
  }

  private async createSnapshotInternal(
    graphId: string,
    userId: string | null,
    isManual: boolean,
  ): Promise<AutomaticCheckpointResult | CreateManualSnapshotResponse> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        return await prisma.$transaction(async (tx) => {
          // Count existing versions under transaction snapshot.
          // ponytail: upgrade to Serializable isolation + advisory lock
          // if phantom-write races are observed in production traffic.
          const count = await tx.documentVersion.count({ where: { graphId } });

          if (count >= MAX_HISTORY) {
            const autoCount = await tx.documentVersion.count({
              where: { graphId, isManual: false },
            });

            if (autoCount === 0) {
              // All 10 slots are manual
              logger.info('Version history full — all snapshots manual, skipping', { graph_id: graphId, is_manual: isManual });
              if (isManual) {
                throw new AppError('VERSION_HISTORY_FULL', 409);
              }
              return { skipped: true } satisfies AutomaticCheckpointResult;
            }

            // Delete oldest automatic snapshot to make room
            const oldestAuto = await tx.documentVersion.findFirst({
              where: { graphId, isManual: false },
              orderBy: { createdAt: 'asc' },
              select: { id: true },
            });
            if (oldestAuto) {
              await tx.documentVersion.delete({ where: { id: oldestAuto.id } });
            }
          }

          // Read current document state
          const doc = await tx.document.findUnique({ where: { graphId } });
          const sourceVersion = doc?.version ?? 0;

          const created = await tx.documentVersion.create({
            data: {
              graphId,
              sourceVersion,
              content: (doc?.content ?? {}) as never,
              plainText: doc?.plainText ?? '',
              yjsState: (doc?.yjsState ?? null) as never,
              isManual,
              createdBy: userId,
            },
          });
          logger.info('Version snapshot created', { graph_id: graphId, version_id: created.id, is_manual: isManual, source_version: sourceVersion });
          return toDto(created as DbRow);
        });
      } catch (error) {
        if (error instanceof AppError) throw error;
        const msg = typeof error === 'object' && error != null && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '';
        const code = typeof error === 'object' && error != null && 'code' in error ? String((error as { code?: unknown }).code ?? '') : '';
        const retryable =
          /serialization|serialize|write conflict|deadlock/i.test(msg) ||
          /^(P2034|P2035)$/.test(code);
        if (retryable && attempt < MAX_RETRIES - 1) continue;
        throw error;
      }
    }
    throw new AppError('Snapshot creation failed after retries', 500);
  }
}
