import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger, pinoLogger } from './config/logger.js';
import { AppError } from './errors/app-error.js';
import { presenter } from './presenters/api.presenter.js';
import routes from './routes/index.js';

const app = express();

app.use(cors({ origin: env.frontendUrl, credentials: true }));
app.use(express.json());
app.use(pinoHttp({
  logger: pinoLogger,
  customLogLevel: (_request, response, error) => {
    if (error || response.statusCode >= 500) return 'error';
    if (response.statusCode >= 400) return 'warn';
    return env.nodeEnv === 'production' ? 'silent' : 'info';
  },
}));
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
