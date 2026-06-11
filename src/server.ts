import 'dotenv/config';
import express from 'express';
import { getAuthUrl, handleAuthCallback } from './qbo/auth.js';
import { getCompanyInfo } from './qbo/client.js';
import { getEstimateStatus } from './qbo/estimates.js';
import { config } from './qbo/config.js';

const app = express();
const pendingStates = new Map<string, boolean>();

app.get('/', (_req, res) => {
  res.redirect('/connect');
});

app.get('/connect', (_req, res) => {
  const { url, state } = getAuthUrl();
  pendingStates.set(state, true);
  res.redirect(url);
});

app.get('/callback', async (req, res) => {
  const { code, state, realmId, error } = req.query as Record<string, string>;

  console.log('[callback] received:', { code: code?.slice(0, 10) + '...', state, realmId, error });

  if (error) {
    res.status(400).send(`OAuth error: ${error}`);
    return;
  }

  if (!code || !realmId) {
    res.status(400).send('Missing code or realmId.');
    return;
  }

  // Warn on state mismatch but don't block — state Map is cleared on server restart
  if (!state || !pendingStates.has(state)) {
    console.warn('[callback] state not in pendingStates (server may have restarted) — proceeding anyway');
  } else {
    pendingStates.delete(state);
  }

  try {
    console.log('[callback] exchanging code for tokens...');
    await handleAuthCallback(code, realmId);
    console.log('[callback] tokens saved successfully');
    res.send('Connected to QuickBooks! You can close this tab.');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[callback] token exchange failed:', message);
    res.status(500).send(`Token exchange failed: ${message}`);
  }
});

app.get('/companyinfo', async (_req, res) => {
  try {
    const data = await getCompanyInfo();
    res.json(data);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/test/status', async (req, res) => {
  const { estimateId } = req.query as { estimateId?: string };
  if (!estimateId) {
    res.status(400).json({ error: 'estimateId query param required' });
    return;
  }
  try {
    const result = await getEstimateStatus(estimateId);
    console.log('Estimate status:', result);
    res.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.listen(config.port, () => {
  console.log(`Server listening on http://localhost:${config.port}`);
});
