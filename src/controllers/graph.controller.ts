import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { GraphService } from '../services/graph.service.js';
import { presenter } from '../presenters/api.presenter.js';

const graphService = new GraphService();

function graphId(request: Request): string {
  const id = request.params.id;
  if (typeof id !== 'string' || !id) throw new AppError('Graph ID is required', 400);
  return id;
}

export async function createGraph(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 201, await graphService.create(request.body), 'Graph created successfully');
}

export async function getGraph(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 200, await graphService.get(graphId(request)), 'Graph retrieved successfully');
}

export async function getGraphsByLabel(request: Request, response: Response): Promise<Response> {
  const label = request.params.label;
  if (typeof label !== 'string' || !label) throw new AppError('Graph label is required', 400);

  let props: Record<string, unknown> = {};
  if (request.query.props !== undefined) {
    if (typeof request.query.props !== 'string') throw new AppError('Props filter must be a JSON string', 400);
    try {
      const parsed = JSON.parse(request.query.props) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new AppError('Props filter must be an object', 400);
      }
      props = parsed as Record<string, unknown>;
    } catch {
      throw new AppError('Props filter must be valid JSON', 400);
    }
  }

  for (const [key, value] of Object.entries(request.query)) {
    if (key === 'props') continue;
    if (typeof value !== 'string') throw new AppError('Graph filters must be single values', 400);
    props[key] = value;
  }

  return presenter.Success(
    response,
    200,
    await graphService.getByLabel(label, props),
    'Graphs retrieved successfully',
  );
}

export async function updateGraph(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 200, await graphService.update(graphId(request), request.body), 'Graph updated successfully');
}

export async function deleteGraph(request: Request, response: Response): Promise<Response> {
  await graphService.remove(graphId(request));
  return presenter.Success(response, 200, null, 'Graph deleted successfully');
}

export async function getGraphHierarchy(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 200, await graphService.hierarchy(graphId(request)), 'Graph hierarchy retrieved successfully');
}
