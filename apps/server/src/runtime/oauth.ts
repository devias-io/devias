import { createHash, randomBytes } from 'node:crypto';
import type { OAuthConfig } from '@devias/core';
import type { GrantedTokens } from '@devias/data-engine';
import type { ModuleFetch } from '@devias/server';

/**
 * The authorization code flow, as the server runs it for OAuth connection providers: the consent page URL, the code
 * exchange and token refreshes. Client credentials are sent in the form body (`client_secret_post`).
 */

export interface OAuthClient {
  clientId: string;
  clientSecret?: string | undefined;
  redirectUri: string;
}

/** The provider answered a token request with an OAuth error; `invalid_grant` means the person must consent again. */
export class OAuthError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

/** A PKCE verifier and its S256 challenge. */
export const pkcePair = (): { verifier: string; challenge: string } => {
  const verifier = randomBytes(32).toString('base64url');

  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export const authorizeUrl = (
  oauth: OAuthConfig,
  client: OAuthClient,
  options: { state: string; codeChallenge?: string | undefined },
): string => {
  const url = new URL(oauth.authorizeUrl);
  const params: Record<string, string> = {
    response_type: 'code',
    client_id: client.clientId,
    redirect_uri: client.redirectUri,
    state: options.state,
    ...(oauth.scopes.length > 0 ? { scope: oauth.scopes.join(' ') } : {}),
    ...(options.codeChallenge ? { code_challenge: options.codeChallenge, code_challenge_method: 'S256' } : {}),
    ...oauth.extraAuthorizeParams,
  };

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  return url.toString();
};

const tokenRequest = async (
  fetch: ModuleFetch,
  oauth: OAuthConfig,
  client: OAuthClient,
  form: Record<string, string>,
  now: Date,
): Promise<GrantedTokens> => {
  const body = new URLSearchParams({
    ...form,
    client_id: client.clientId,
    ...(client.clientSecret ? { client_secret: client.clientSecret } : {}),
  });
  let response: Response;

  try {
    response = await fetch(oauth.tokenUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
  } catch (error) {
    throw new Error(`The token endpoint could not be reached: ${error instanceof Error ? error.message : error}`);
  }

  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok || typeof json.error === 'string') {
    const code = typeof json.error === 'string' ? json.error : `http_${response.status}`;
    const detail = typeof json.error_description === 'string' ? json.error_description : `answered ${response.status}`;

    throw new OAuthError(code, `The provider refused the token request (${code}): ${detail}`);
  }

  if (typeof json.access_token !== 'string') {
    throw new OAuthError('invalid_response', 'The provider sent no access token');
  }

  const expiresIn = Number(json.expires_in);

  return {
    accessToken: json.access_token,
    ...(typeof json.refresh_token === 'string' ? { refreshToken: json.refresh_token } : {}),
    ...(typeof json.token_type === 'string' ? { tokenType: json.token_type } : {}),
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? new Date(now.getTime() + expiresIn * 1000) : null,
    ...(typeof json.scope === 'string' ? { scopes: json.scope.split(/[\s,]+/).filter(Boolean) } : {}),
  };
};

export const exchangeCode = (
  fetch: ModuleFetch,
  oauth: OAuthConfig,
  client: OAuthClient,
  input: { code: string; codeVerifier: string | null },
  now: Date,
): Promise<GrantedTokens> =>
  tokenRequest(
    fetch,
    oauth,
    client,
    {
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: client.redirectUri,
      ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
    },
    now,
  );

export const refreshTokens = (
  fetch: ModuleFetch,
  oauth: OAuthConfig,
  client: OAuthClient,
  refreshToken: string,
  now: Date,
): Promise<GrantedTokens> =>
  tokenRequest(fetch, oauth, client, { grant_type: 'refresh_token', refresh_token: refreshToken }, now);
