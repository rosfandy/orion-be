import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { presenter } from '../presenters/api.presenter.js';

const authService = new AuthService();

export async function register(request: Request, response: Response): Promise<Response> {
  const result = await authService.register(request.body);
  return presenter.Success(response, 201, result, 'Registration successful');
}

export async function login(request: Request, response: Response): Promise<Response> {
  const result = await authService.login(request.body);
  return presenter.Success(response, 200, result, 'Login successful');
}

export function getMe(request: Request, response: Response): Response {
  return presenter.Success(response, 200, request.authUser, 'Current user retrieved');
}
