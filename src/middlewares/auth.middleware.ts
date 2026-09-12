import type { NextFunction, Request, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { AppError } from '../errors/app-error.js';

function getToken(request: Request): string | undefined {
  const authorization = request.headers.authorization;

  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice(7);
  }

  return request.headers.cookie
    ?.split(';')
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith('token='))
    ?.slice('token='.length);
}

export async function authenticate(request: Request, _response: Response, next: NextFunction): Promise<void> {
  const token = getToken(request);

  if (!token) {
    logger.info(`${request.method} ${request.originalUrl}`, { message: 'No token provided' });
    next(new AppError('Authentication required', 401));
    return;
  }

  try {
    const payload = jwt.verify(token, env.jwtSecret) as JwtPayload;
    logger.info(`${request.method} ${request.originalUrl}`, { message: 'Token decoded', sub: payload.sub });

    if (!payload.sub) {
      throw new Error('Token subject is missing');
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, name: true, email: true },
    });

    if (!user) {
      throw new AppError('User not found', 401);
    }

    request.authUser = user;
    next();
  } catch (error) {
    logger.info(`${request.method} ${request.originalUrl}`, {
      message: 'Token verification failed',
      error: error instanceof Error ? error.message : String(error),
    });
    next(error instanceof AppError ? error : new AppError('Invalid or expired token', 401));
  }
}
