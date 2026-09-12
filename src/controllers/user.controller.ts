import type { Request, Response } from 'express';
import { AppError } from '../errors/app-error.js';
import { UserService } from '../services/user.service.js';
import { presenter } from '../presenters/api.presenter.js';

const userService = new UserService();

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new AppError(`${field} is required`, 400);
  return value.trim();
}

export async function searchUsersByEmail(request: Request, response: Response): Promise<Response> {
  const email = requireText(request.query.email, 'Email');
  return presenter.Success(response, 200, await userService.searchUsersByEmail(email), 'User search completed');
}
