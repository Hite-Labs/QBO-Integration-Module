import crypto from 'node:crypto';
import axios from 'axios';
import { config, ENDPOINTS } from './config.ts';
import { saveTokens } from './token-store.ts';

function basicAuth(): string {
  return Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64');
}

export function getAuthUrl(): { url: string; state: string } {
  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id: config.clientId,
    scope: config.scopes,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state,
  });
  return { url: `${ENDPOINTS.authBase}?${params.toString()}`, state };
}

export async function handleAuthCallback(code: string, realmId: string): Promise<void> {
  const response = await axios.post(
    ENDPOINTS.tokenUrl,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${basicAuth()}`,
      },
    }
  );
  await saveTokens(response.data, realmId);
}

export async function refreshAccessToken(refreshToken: string, realmId: string): Promise<void> {
  const response = await axios.post(
    ENDPOINTS.tokenUrl,
    new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json',
        'Authorization': `Basic ${basicAuth()}`,
      },
    }
  );
  await saveTokens(response.data, realmId);
}
