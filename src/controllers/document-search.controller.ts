import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { DocumentSearchService } from '../services/document-search.service.js';
import { presenter } from '../presenters/api.presenter.js';

const searchService = new DocumentSearchService();

export async function searchDocuments(request: Request, response: Response): Promise<Response> {
  const workspaceGraphId = request.query.workspace_graph_id as string | undefined;
  const q = request.query.q as string | undefined;

  if (!workspaceGraphId || !workspaceGraphId.trim()) {
    throw new AppError('workspace_graph_id is required', 400);
  }
  if (q === undefined || q === null) {
    throw new AppError('q is required', 400);
  }

  return presenter.Success(
    response,
    200,
    await searchService.search({ q, workspace_graph_id: workspaceGraphId.trim() }, request.authUser!.id),
    'Documents searched successfully',
  );
}
