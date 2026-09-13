import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { DocumentService } from '../services/document.service.js';
import { presenter } from '../presenters/api.presenter.js';

const documentService = new DocumentService();

function graphId(request: Request): string {
  const id = request.params.graphId;
  if (typeof id !== 'string' || !id) throw new AppError('Graph ID is required', 400);
  return id;
}

export async function getDocument(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 200, await documentService.load(graphId(request), request.authUser!.id), 'Document retrieved successfully');
}

export async function saveDocument(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 200, await documentService.save(graphId(request), request.authUser!.id, request.body), 'Document saved successfully');
}
