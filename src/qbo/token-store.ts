import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '../..', 'data');
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.json');

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_at: number;
  refresh_expires_at: number;
  realmId: string;
}

interface TokenStore {
  [realmId: string]: TokenSet;
}

interface IntuitTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  x_refresh_token_expires_in: number;
}

export async function saveTokens(tokenResponse: IntuitTokenResponse, realmId: string): Promise<void> {
  const now = Date.now();
  const tokenSet: TokenSet = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token,
    token_type: tokenResponse.token_type,
    expires_at: now + tokenResponse.expires_in * 1000,
    refresh_expires_at: now + tokenResponse.x_refresh_token_expires_in * 1000,
    realmId,
  };

  await fs.mkdir(DATA_DIR, { recursive: true });

  let store: TokenStore = {};
  try {
    const raw = await fs.readFile(TOKENS_FILE, 'utf-8');
    store = JSON.parse(raw);
  } catch {
    // file doesn't exist yet — start fresh
  }

  store[realmId] = tokenSet;
  await fs.writeFile(TOKENS_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

export async function loadTokens(realmId: string): Promise<TokenSet | null> {
  try {
    const raw = await fs.readFile(TOKENS_FILE, 'utf-8');
    const store: TokenStore = JSON.parse(raw);
    return store[realmId] ?? null;
  } catch {
    return null;
  }
}

export function isAccessTokenExpired(tokens: TokenSet, skewMs = 60_000): boolean {
  return Date.now() + skewMs >= tokens.expires_at;
}

export function isRefreshTokenExpired(tokens: TokenSet): boolean {
  return Date.now() >= tokens.refresh_expires_at;
}

export async function clearTokens(realmId: string): Promise<void> {
  try {
    const raw = await fs.readFile(TOKENS_FILE, 'utf-8');
    const store: TokenStore = JSON.parse(raw);
    delete store[realmId];
    await fs.writeFile(TOKENS_FILE, JSON.stringify(store, null, 2), 'utf-8');
  } catch {
    // nothing to clear
  }
}
