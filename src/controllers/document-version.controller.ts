import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { DocumentVersionService } from '../services/document-version.service.js';
import { presenter } from '../presenters/api.presenter.js';

const versionService = new DocumentVersionService();

function graphId(request: Request): string {
  const id = request.params.graphId;
  if (typeof id !== 'string' || !id) throw new AppError('Graph ID is required', 400);
  return id;
}

function versionId(request: Request): string {
  const id = request.params.versionId;
  if (typeof id !== 'string' || !id) throw new AppError('Version ID is required', 400);
  return id;
}

export async function listVersions(request: Request, response: Response): Promise<Response> {
  return presenter.Success(
    response,
    200,
    await versionService.listVersions(graphId(request), request.authUser!.id),
    'Version history retrieved successfully',
  );
}

export async function getVersion(request: Request, response: Response): Promise<Response> {
  return presenter.Success(
    response,
    200,
    await versionService.getVersion(graphId(request), request.authUser!.id, versionId(request)),
    'Version retrieved successfully',
  );
}

export async function createManualSnapshot(request: Request, response: Response): Promise<Response> {
  try {
    const result = await versionService.createManualSnapshot(graphId(request), request.authUser!.id);
    return presenter.Success(response, 201, result, 'Manual snapshot created successfully');
  } catch (error) {
    if (error instanceof AppError && error.message === 'VERSION_HISTORY_FULL') {
      return presenter.Error(response, 409, error.message);
    }
    throw error;
  }
}

export async function deleteVersion(request: Request, response: Response): Promise<Response> {
  await versionService.deleteVersion(graphId(request), request.authUser!.id, versionId(request));
  return presenter.Success(response, 200, null, 'Version deleted successfully');
}
