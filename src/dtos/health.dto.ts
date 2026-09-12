export interface HealthStatus {
  status: 'ok';
  service: string;
  timestamp: string;
}

export class HealthResponseDto {
  readonly status: HealthStatus['status'];
  readonly service: string;
  readonly timestamp: string;

  constructor(healthStatus: HealthStatus) {
    this.status = healthStatus.status;
    this.service = healthStatus.service;
    this.timestamp = healthStatus.timestamp;
  }
}
