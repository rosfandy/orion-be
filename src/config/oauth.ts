import { env } from './env.js';

export interface OAuthProviderConfig {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
}

export const oauthConfig = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    callbackUrl: process.env.GOOGLE_CALLBACK_URL ?? `${env.baseUrl}/api/auth/google/callback`,
  } satisfies OAuthProviderConfig,
  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? '',
    callbackUrl: process.env.GITHUB_CALLBACK_URL ?? `${env.baseUrl}/api/auth/github/callback`,
  } satisfies OAuthProviderConfig,
};

export function isOAuthProviderConfigured(provider: OAuthProviderConfig): boolean {
  return Boolean(provider.clientId && provider.clientSecret && provider.callbackUrl);
}

export type OAuthProvider = keyof typeof oauthConfig;
