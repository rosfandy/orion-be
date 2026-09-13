import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { CollaborationService } from '../services/collaboration.service.js';
import { presenter } from '../presenters/api.presenter.js';

const collaborationService = new CollaborationService();

function graphId(request: Request): string {
  const id = request.params.graphId;
  if (typeof id !== 'string' || !id) throw new AppError('Graph ID is required', 400);
  return id;
}

export async function authorizeCollaboration(request: Request, response: Response): Promise<Response> {
  const graphId = request.body?.graphId as string | undefined;
  if (!graphId) throw new AppError('Graph ID is required', 400);
  const result = await collaborationService.authorize(graphId, request.authUser!.id);
  return presenter.Success(response, 200, result, 'Collaboration authorized successfully');
}
