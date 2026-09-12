import type { Request, Response } from 'express';
import type { GoogleOneTapDto } from '../dtos/google-one-tap.dto.js';
import { env } from '../config/env.js';
import { AppError } from '../errors/app-error.js';
import { OAuthService } from '../services/oauth.service.js';
import type { OAuthProvider } from '../config/oauth.js';
import { presenter } from '../presenters/api.presenter.js';

const oauthService = new OAuthService();

function getProvider(request: Request): OAuthProvider {
  const provider = request.params.provider;

  switch (provider) {
    case 'google':
    case 'github':
      return provider;
    default:
      throw new AppError('Unsupported OAuth provider', 400);
  }
}

export function startOAuth(request: Request, response: Response): void {
  response.redirect(oauthService.getAuthorizationUrl(getProvider(request)));
}

export async function oauthCallback(request: Request, response: Response): Promise<void> {
  const code = typeof request.query.code === 'string' ? request.query.code : '';
  const state = typeof request.query.state === 'string' ? request.query.state : '';

  if (!code || !state) {
    throw new AppError('OAuth code and state are required', 400);
  }

  const result = await oauthService.authenticate(getProvider(request), code, state);
  response.cookie('token', result.token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000,
  });
  response.redirect(`${env.frontendUrl}/oauth/${getProvider(request)}/callback?success=true`);
}

export async function googleOneTap(request: Request, response: Response): Promise<Response> {
  const body = request.body as Partial<GoogleOneTapDto>;

  if (typeof body.credential !== 'string' || !body.credential) {
    throw new AppError('Google credential is required', 400);
  }

  const result = await oauthService.authenticateOneTap(body.credential);
  return presenter.Success(response, 200, result, 'Google One Tap authentication successful');
}
