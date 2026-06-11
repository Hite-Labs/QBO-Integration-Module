import 'dotenv/config';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

export const config = Object.freeze({
  clientId: requireEnv('QB_CLIENT_ID'),
  clientSecret: requireEnv('QB_CLIENT_SECRET'),
  realmId: requireEnv('QB_REALM_ID'),
  redirectUri: process.env['QB_REDIRECT_URI'] ?? 'http://localhost:8000/callback',
  environment: (process.env['QB_ENVIRONMENT'] ?? 'sandbox') as 'sandbox' | 'production',
  scopes: process.env['QB_SCOPES'] ?? 'com.intuit.quickbooks.accounting',
  port: parseInt(process.env['PORT'] ?? '8000', 10),
});

export const ENDPOINTS = Object.freeze({
  authBase: 'https://appcenter.intuit.com/connect/oauth2',
  tokenUrl: 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer',
  apiBase: config.environment === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com',
});
