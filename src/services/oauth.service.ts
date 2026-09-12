import crypto from 'node:crypto';
import { Prisma } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { AuthResponseDto, AuthUserDto } from '../dtos/auth.dto.js';
import { AppError } from '../errors/app-error.js';
import {
  isOAuthProviderConfigured,
  oauthConfig,
  type OAuthProvider,
} from '../config/oauth.js';

type ProviderProfile = {
  id: string;
  email: string;
  name: string;
};

function createState(provider: OAuthProvider): string {
  return jwt.sign(
    { provider, nonce: crypto.randomBytes(16).toString('hex') },
    env.jwtSecret,
    { expiresIn: '10m' },
  );
}

function verifyState(state: string, provider: OAuthProvider): void {
  try {
    const payload = jwt.verify(state, env.jwtSecret) as JwtPayload & { provider?: string };

    if (payload.provider !== provider) {
      throw new Error('Provider mismatch');
    }
  } catch {
    throw new AppError('Invalid or expired OAuth state', 400);
  }
}

function getConfig(provider: OAuthProvider) {
  const config = oauthConfig[provider];

  if (!isOAuthProviderConfigured(config)) {
    throw new AppError(`${provider} OAuth is not configured`, 503);
  }

  return config;
}

async function parseResponse<T>(response: globalThis.Response): Promise<T> {
  if (!response.ok) {
    const providerError = await response.text();
    logger.error('OAuth provider request failed', {
      status: response.status,
      body: providerError,
    });
    throw new AppError('OAuth provider request failed', 502);
  }

  return response.json() as Promise<T>;
}

async function getGoogleProfile(code: string): Promise<ProviderProfile> {
  const config = getConfig('google');
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
      grant_type: 'authorization_code',
    }),
  });
  const tokens = await parseResponse<{ access_token?: string }>(tokenResponse);

  if (!tokens.access_token) {
    throw new AppError('Google access token was not returned', 502);
  }

  const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  const profile = await parseResponse<{ sub?: string; email?: string; name?: string }>(profileResponse);

  if (!profile.sub || !profile.email) {
    throw new AppError('Google account email is unavailable', 400);
  }

  return { id: profile.sub, email: profile.email, name: profile.name ?? profile.email };
}

async function getGithubProfile(code: string): Promise<ProviderProfile> {
  const config = getConfig('github');
  const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.callbackUrl,
    }),
  });
  const tokens = await parseResponse<{ access_token?: string }>(tokenResponse);

  if (!tokens.access_token) {
    throw new AppError('GitHub access token was not returned', 502);
  }

  const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/vnd.github+json' };
  const profile = await parseResponse<{ id?: number; login?: string; name?: string; email?: string }>(
    await fetch('https://api.github.com/user', { headers }),
  );
  let email = profile.email;

  if (!email) {
    const emails = await parseResponse<Array<{ email: string; primary: boolean; verified: boolean }>>(
      await fetch('https://api.github.com/user/emails', { headers }),
    );
    email = emails.find((item) => item.primary && item.verified)?.email;
  }

  if (!profile.id || !email) {
    throw new AppError('GitHub account email is unavailable', 400);
  }

  return { id: String(profile.id), email, name: profile.name ?? profile.login ?? email };
}

export class OAuthService {
  getAuthorizationUrl(provider: OAuthProvider): string {
    const config = getConfig(provider);
    const state = createState(provider);
    const params = new URLSearchParams({
      client_id: config.clientId,
      redirect_uri: config.callbackUrl,
      response_type: 'code',
      state,
    });

    switch (provider) {
      case 'google':
        params.set('scope', 'openid email profile');
        params.set('access_type', 'offline');
        return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
      case 'github':
        params.set('scope', 'read:user user:email');
        return `https://github.com/login/oauth/authorize?${params}`;
    }
  }

  async authenticate(provider: OAuthProvider, code: string, state: string): Promise<AuthResponseDto> {
    verifyState(state, provider);
    let profile: ProviderProfile;

    switch (provider) {
      case 'google':
        profile = await getGoogleProfile(code);
        break;
      case 'github':
        profile = await getGithubProfile(code);
        break;
    }
    const existingAccount = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: profile.id } },
      include: { user: true },
    });
    const user = existingAccount?.user ?? await prisma.user.upsert({
      where: { email: profile.email.toLowerCase() },
      update: { name: profile.name },
      create: { name: profile.name, email: profile.email.toLowerCase() },
    });

    if (!existingAccount) {
      try {
        await prisma.account.create({
          data: { provider, providerAccountId: profile.id, userId: user.id },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
      }
    }

    const userDto: AuthUserDto = { id: user.id, name: user.name, email: user.email };
    return {
      token: jwt.sign({ email: user.email }, env.jwtSecret, { subject: user.id, expiresIn: '1d' }),
      user: userDto,
    };
  }

  async authenticateOneTap(credential: string): Promise<AuthResponseDto> {
    const config = getConfig('google');
    const client = new OAuth2Client(config.clientId);
    let payload;

    try {
      const ticket = await client.verifyIdToken({
        idToken: credential,
        audience: config.clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw new AppError('Invalid Google One Tap credential', 401);
    }

    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new AppError('Google account email is unavailable', 400);
    }

    const provider = 'google' as const;
    const existingAccount = await prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId: payload.sub } },
      include: { user: true },
    });
    const user = existingAccount?.user ?? await prisma.user.upsert({
      where: { email: payload.email.toLowerCase() },
      update: { name: payload.name ?? payload.email },
      create: {
        name: payload.name ?? payload.email,
        email: payload.email.toLowerCase(),
      },
    });

    if (!existingAccount) {
      try {
        await prisma.account.create({
          data: { provider, providerAccountId: payload.sub, userId: user.id },
        });
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
          throw error;
        }
      }
    }

    const userDto: AuthUserDto = { id: user.id, name: user.name, email: user.email };
    return {
      token: jwt.sign({ email: user.email }, env.jwtSecret, { subject: user.id, expiresIn: '1d' }),
      user: userDto,
    };
  }
}
