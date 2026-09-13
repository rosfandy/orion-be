import { prisma } from '../config/database.js';
import { logger } from '../config/logger.js';
import { AppError } from '../errors/app-error.js';
import type { SearchDocumentsQuery, SearchDocumentsResponse } from '../dtos/document-search.dto.js';

/**
 * Search latest durable Document rows using PostgreSQL full-text search on plain_text.
 * Results are scoped to workspaces the authenticated user can access.
 */
export class DocumentSearchService {
  async search(query: SearchDocumentsQuery, userId: string): Promise<SearchDocumentsResponse> {
    // 1. Validate workspace input — never trust caller alone; verify membership
    const workspace = await prisma.workspace.findFirst({
      where: { graphId: query.workspace_graph_id },
      select: { id: true },
    });
    if (!workspace) throw new AppError('Workspace not found', 404);

    const membership = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: workspace.id, userId } },
    });
    if (!membership) throw new AppError('Access denied', 403);

    // 2. Sanitize query: empty / whitespace-only returns no results safely
    const sanitizedQuery = query.q.trim();
    if (!sanitizedQuery) {
      return { results: [] };
    }

    // ponytail: upgrade to native $N params once Prisma 7 supports array-binding.
    // Pg-safe literal escape: double-single-quote inside string.
    const escQ = sanitizedQuery.replace(/'/g, "''");
    const escU = userId.replace(/'/g, "''");

    // 3. FTS via websearch_to_tsquery + ts_rank.
    // Excludes historical versions — only the latest document row is indexed.
    // workspace_graph_id join enforces document-orbit-to-workspace contract.
    // ponytail: re-add ts_headline with explicit options once Prisma 6 raw-query
    // parser is confirmed safe (current parser misreads '=' in options strings).
    type Row = { graph_id: string; rank: number; headline: string };

    const sql = [
      'SELECT',
      '  d.graph_id,',
      `  ts_rank(d.search_vector, websearch_to_tsquery('english', '${escQ}'::text)::tsquery) AS rank,`,
      "  substring(d.plain_text from 1 for 200) AS headline",
      'FROM documents d',
      'JOIN workspaces w ON w.graph_id = d.workspace_graph_id',
      'JOIN workspace_members wm ON wm.workspace_id = w.id',
      `WHERE d.search_vector @@ websearch_to_tsquery('english', '${escQ}'::text)::tsquery`,
      `  AND wm.user_id = '${escU}'`,
      'ORDER BY rank DESC',
      'LIMIT 20',
    ].join('\n');

    const rows = (await prisma.$queryRawUnsafe<Row>(sql)) as unknown as Row[];
    logger.info('FTS search executed', { query_len: sanitizedQuery.length, results: rows.length, workspace_graph_id: query.workspace_graph_id });
    return { results: rows };
  }
}
