import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import { config, ENDPOINTS } from './config.ts';
import { loadTokens, isAccessTokenExpired, isRefreshTokenExpired } from './token-store.ts';
import { refreshAccessToken } from './auth.ts';

const MINOR_VERSION = '73';

export async function getValidAccessToken(): Promise<string> {
  const tokens = await loadTokens(config.realmId);
  if (!tokens) {
    throw new Error('No tokens found. Complete the OAuth flow at /connect first.');
  }
  if (isRefreshTokenExpired(tokens)) {
    throw new Error('Refresh token expired. Re-authorize at /connect.');
  }
  if (isAccessTokenExpired(tokens)) {
    await refreshAccessToken(tokens.refresh_token, config.realmId);
    const refreshed = await loadTokens(config.realmId);
    if (!refreshed) throw new Error('Token refresh failed.');
    return refreshed.access_token;
  }
  return tokens.access_token;
}

export async function qboRequest<T = unknown>(
  method: string,
  path: string,
  opts: { params?: Record<string, string>; data?: unknown } = {}
): Promise<T> {
  const accessToken = await getValidAccessToken();

  const requestConfig: AxiosRequestConfig = {
    method,
    url: `${ENDPOINTS.apiBase}${path}`,
    params: { minorversion: MINOR_VERSION, ...opts.params },
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    data: opts.data,
  };

  try {
    const response = await axios(requestConfig);
    return response.data as T;
  } catch (err: unknown) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      // Reactive refresh: token may have been revoked or clock-drifted
      const tokens = await loadTokens(config.realmId);
      if (!tokens) throw new Error('No tokens available for refresh.');
      await refreshAccessToken(tokens.refresh_token, config.realmId);

      const retried = await axios({
        ...requestConfig,
        headers: {
          ...requestConfig.headers,
          Authorization: `Bearer ${await getValidAccessToken()}`,
        },
      });
      return retried.data as T;
    }
    throw err;
  }
}

export async function getCompanyInfo(): Promise<unknown> {
  return qboRequest('GET', `/v3/company/${config.realmId}/companyinfo/${config.realmId}`);
}
