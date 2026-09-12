import type { Request, Response } from 'express';
import { HealthResponseDto } from '../dtos/health.dto.js';
import { HealthService } from '../services/health.service.js';
import { presenter } from '../presenters/api.presenter.js';

const healthService = new HealthService();

export function getHealth(_request: Request, response: Response): Response {
  const healthStatus = healthService.getStatus();

  return presenter.Success(response, 200, new HealthResponseDto(healthStatus), 'Service is healthy');
}
