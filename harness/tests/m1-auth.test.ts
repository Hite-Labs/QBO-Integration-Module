import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_FILE = path.resolve(__dirname, '../../data/tokens.json');
const REALM_ID = process.env['QB_REALM_ID'] ?? '';

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SLOW';
  detail: string;
  durationMs?: number;
  error?: string;
}

const results: CheckResult[] = [];
const manualItems: string[] = [
  'Open http://localhost:8000/connect in a browser and confirm the Intuit login screen loads',
  'Complete the OAuth flow and confirm the browser reaches /callback without an error page',
  'Confirm realmId in tokens.json matches the sandbox company ID in the Intuit Developer portal',
];

function pass(name: string, detail: string, durationMs?: number): void {
  results.push({ name, status: 'PASS', detail, durationMs });
  if (durationMs !== undefined) {
    console.log(`  PASS  ${name}: ${detail} (${durationMs}ms)`);
  } else {
    console.log(`  PASS  ${name}: ${detail}`);
  }
}

function fail(name: string, expected: string, got: string, error?: string): void {
  results.push({ name, status: 'FAIL', detail: `Expected: ${expected} | Got: ${got}`, error });
  console.log(`  FAIL  ${name}`);
  console.log(`        Expected: ${expected}`);
  console.log(`        Got:      ${got}`);
  if (error) console.log(`        Error:    ${error}`);
}

function slow(name: string, durationMs: number, thresholdMs: number): void {
  results.push({ name, status: 'SLOW', detail: `took ${durationMs}ms (threshold: ${thresholdMs}ms)`, durationMs });
  console.log(`  SLOW  ${name}: took ${durationMs}ms (threshold: ${thresholdMs}ms)`);
}

async function runChecks(): Promise<void> {
  const suiteStart = Date.now();
  console.log('\n=== M1 Auth — Automated Checks ===\n');

  // Check 1: tokens.json exists
  try {
    await fs.access(TOKENS_FILE);
    pass('tokens.json exists', 'file found at data/tokens.json');
  } catch {
    fail('tokens.json exists', 'file at data/tokens.json', 'file not found — run the OAuth flow first via /connect');
    await writeReport(suiteStart);
    return;
  }

  // Check 2: valid JSON
  let store: Record<string, unknown>;
  try {
    const raw = await fs.readFile(TOKENS_FILE, 'utf-8');
    store = JSON.parse(raw);
    pass('tokens.json is valid JSON', 'parsed successfully');
  } catch (err) {
    fail('tokens.json is valid JSON', 'valid JSON', 'parse error', String(err));
    await writeReport(suiteStart);
    return;
  }

  // Check 3: keyed by realmId (not a flat blob)
  if (!REALM_ID) {
    fail('tokens.json keyed by realmId', 'QB_REALM_ID set in .env', 'QB_REALM_ID is empty');
    await writeReport(suiteStart);
    return;
  }

  const tokenSet = store[REALM_ID] as Record<string, unknown> | undefined;
  if (!tokenSet || typeof tokenSet !== 'object') {
    fail(
      'tokens.json keyed by realmId',
      `key "${REALM_ID}" present`,
      `keys found: ${Object.keys(store).join(', ') || '(none)'}`
    );
    await writeReport(suiteStart);
    return;
  }
  pass('tokens.json keyed by realmId', `key "${REALM_ID}" present`);

  // Check 4: access_token present
  if (typeof tokenSet['access_token'] === 'string' && tokenSet['access_token'].length > 0) {
    pass('access_token present', `...${(tokenSet['access_token'] as string).slice(-4)}`);
  } else {
    fail('access_token present', 'non-empty string', String(tokenSet['access_token']));
  }

  // Check 5: refresh_token present
  if (typeof tokenSet['refresh_token'] === 'string' && tokenSet['refresh_token'].length > 0) {
    pass('refresh_token present', `...${(tokenSet['refresh_token'] as string).slice(-4)}`);
  } else {
    fail('refresh_token present', 'non-empty string', String(tokenSet['refresh_token']));
  }

  // Check 6: realmId in file matches .env
  if (tokenSet['realmId'] === REALM_ID) {
    pass('realmId matches .env', REALM_ID);
  } else {
    fail('realmId matches .env', REALM_ID, String(tokenSet['realmId']));
  }

  // Check 7: live QBO API call
  try {
    const { qboRequest } = await import('../../src/qbo/client.ts');
    const apiStart = Date.now();
    const result = await qboRequest<{ QueryResponse: { Customer?: unknown[] } }>(
      'GET',
      `/v3/company/${REALM_ID}/query`,
      { params: { query: 'SELECT * FROM Customer MAXRESULTS 1' } }
    );
    const apiDuration = Date.now() - apiStart;

    if (apiDuration > 3000) slow('QBO API call latency', apiDuration, 3000);

    const customers = result?.QueryResponse?.Customer;
    if (Array.isArray(customers) && customers.length > 0) {
      pass('QBO query returns data', `Customer count ≥ 1`, apiDuration);
    } else {
      fail('QBO query returns data', 'at least 1 Customer', 'empty or missing QueryResponse.Customer');
    }
  } catch (err) {
    fail('QBO API call succeeds', 'HTTP 200 with data', 'request threw', String(err));
  }

  const suiteDuration = Date.now() - suiteStart;
  if (suiteDuration > 30000) slow('Full suite duration', suiteDuration, 30000);

  await writeReport(suiteStart, suiteDuration);
}

async function writeReport(suiteStart: number, suiteDuration?: number): Promise<void> {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const slowFlags = results.filter((r) => r.status === 'SLOW').length;
  const timestamp = new Date().toISOString();
  const duration = suiteDuration ?? Date.now() - suiteStart;
  const gate = failed === 0
    ? 'PASS — all automated checks passed. Complete manual items above, then proceed.'
    : `HOLD — ${failed} automated check(s) failed. Do not proceed. See FAIL section above.`;

  let report = `# Test Report — Milestone 1: Auth\n`;
  report += `Date: ${timestamp}\n`;
  report += `Duration: ${duration}ms\n\n`;
  report += `## Summary\n`;
  report += `- Passed: ${passed}\n`;
  report += `- Failed: ${failed}\n`;
  report += `- Slow flags: ${slowFlags}\n`;
  report += `- Manual items required: ${manualItems.length}\n\n`;
  report += `## Results\n\n`;

  const passes = results.filter((r) => r.status === 'PASS');
  if (passes.length > 0) {
    report += `### PASS\n`;
    for (const r of passes) {
      report += `- ${r.name}: ${r.detail}\n`;
    }
    report += '\n';
  }

  const fails = results.filter((r) => r.status === 'FAIL');
  if (fails.length > 0) {
    report += `### FAIL\n`;
    for (const r of fails) {
      report += `- ${r.name}\n  ${r.detail}\n`;
      if (r.error) report += `  Error: ${r.error}\n`;
    }
    report += '\n';
  }

  const slows = results.filter((r) => r.status === 'SLOW');
  if (slows.length > 0) {
    report += `### SLOW FLAGS\n`;
    for (const r of slows) {
      report += `- ${r.name}: ${r.detail}\n`;
    }
    report += '\n';
  }

  report += `## Manual Verification Required\n`;
  report += `The following cannot be confirmed automatically. Do these before marking this milestone complete:\n\n`;
  for (const item of manualItems) {
    report += `- [ ] ${item}\n`;
  }
  report += `\n## Milestone Gate\n${gate}\n`;

  const reportsDir = path.resolve(__dirname, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const safeTs = timestamp.replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `report-m1-${safeTs}.md`);
  await fs.writeFile(reportPath, report, 'utf-8');

  console.log('\n' + report);
  console.log(`Report written to: ${reportPath}`);
}

runChecks().catch((err) => {
  console.error('Unexpected error running M1 tests:', err);
  process.exit(1);
});
