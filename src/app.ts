import express, { type ErrorRequestHandler, type Request } from 'express';
import cors from 'cors';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { AppError } from './errors/app-error.js';
import { presenter } from './presenters/api.presenter.js';
import routes from './routes/index.js';

const app = express();

app.use(cors({ origin: env.frontendUrl, credentials: true, allowedHeaders: ['Authorization', 'Content-Type'] }));
app.use(express.json());

app.use((request: Request, _response, next) => {
  const logData = {
    method: request.method,
    endpoint: request.originalUrl,
    payload: request.body,
  };
  if (request.method !== 'GET') {
    logger.info(`${request.method} ${request.originalUrl}`, logData);
  } else {
    logger.info(`GET ${request.originalUrl}`);
  }
  next();
});

app.use('/api', routes);

app.use((_request, response) => {
  return presenter.Error(response, 404, 'Route not found');
});

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  logger.error('Unhandled application error', error);
  const statusCode = error instanceof AppError ? error.statusCode : 500;
  const message = error instanceof AppError ? error.message : 'Internal server error';
  return presenter.Error(response, statusCode, message);
};

app.use(errorHandler);

export default app;
