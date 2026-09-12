import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { WorkspaceService } from '../services/workspace.service.js';
import { presenter } from '../presenters/api.presenter.js';

const workspaceService = new WorkspaceService();

function userId(request: Request): string {
  if (!request.authUser) throw new AppError('Authentication required', 401);
  return request.authUser.id;
}

function workspaceId(request: Request): string {
  const id = request.params.id;
  if (typeof id !== 'string' || !id) throw new AppError('Workspace ID is required', 400);
  return id;
}

function targetUserId(request: Request): string {
  const id = request.params.userId;
  if (typeof id !== 'string' || !id) throw new AppError('User ID is required', 400);
  return id;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(`${field} is required`, 400);
  return value.trim();
}

export async function listWorkspaces(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 200, await workspaceService.list(userId(request)), 'Workspaces retrieved successfully');
}

export async function getWorkspace(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 200, await workspaceService.get(userId(request), workspaceId(request)), 'Workspace retrieved successfully');
}

export async function createWorkspace(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 201, await workspaceService.create(userId(request), request.body), 'Workspace created successfully');
}

export async function updateWorkspace(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 200, await workspaceService.update(userId(request), workspaceId(request), request.body), 'Workspace updated successfully');
}

export async function deleteWorkspace(request: Request, response: Response): Promise<Response> {
  await workspaceService.remove(userId(request), workspaceId(request));
  return presenter.Success(response, 200, null, 'Workspace deleted successfully');
}

export async function addWorkspaceMember(request: Request, response: Response): Promise<Response> {
  return presenter.Success(response, 201, await workspaceService.addMember(userId(request), workspaceId(request), request.body), 'Workspace member added successfully');
}

export async function searchUsersByEmail(request: Request, response: Response): Promise<Response> {
  const email = requireText(request.query.email, 'Email');
  return presenter.Success(response, 200, await workspaceService.searchUsersByEmail(email), 'User search completed');
}

export async function removeWorkspaceMember(request: Request, response: Response): Promise<Response> {
  await workspaceService.removeMember(userId(request), workspaceId(request), targetUserId(request));
  return presenter.Success(response, 200, null, 'Workspace member removed successfully');
}
