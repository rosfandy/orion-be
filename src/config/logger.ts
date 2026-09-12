import { env } from './env.js';
import pino from 'pino';
import type { Logger } from '../interfaces/logger.interface.js';

const pinoLogger = pino({
  level: env.nodeEnv === 'production' ? 'warn' : 'info',
  transport: env.nodeEnv === 'production'
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          singleLine: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
});

export const logger: Logger = {
  info(message: string, data?: unknown): void {
    pinoLogger.info(data ?? {}, message);
  },

  error(message: string, error?: unknown): void {
    pinoLogger.error({ err: error }, message);
  },
};

export { pinoLogger };
