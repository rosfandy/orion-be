import type { HealthStatus } from '../dtos/health.dto.js';

export class HealthService {
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      service: 'orion-be',
      timestamp: new Date().toISOString(),
    };
  }
}
