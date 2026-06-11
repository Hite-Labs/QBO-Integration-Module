import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
  'Open sandbox QBO UI → Products and Services → confirm both items appear as Service type with an income account assigned',
];

function pass(name: string, detail: string, durationMs?: number): void {
  results.push({ name, status: 'PASS', detail, durationMs });
  console.log(`  PASS  ${name}: ${detail}${durationMs !== undefined ? ` (${durationMs}ms)` : ''}`);
}

function fail(name: string, expected: string, got: string, error?: string): void {
  results.push({ name, status: 'FAIL', detail: `Expected: ${expected} | Got: ${got}`, error });
  console.log(`  FAIL  ${name}\n        Expected: ${expected}\n        Got: ${got}${error ? `\n        Error: ${error}` : ''}`);
}

function slow(name: string, durationMs: number, thresholdMs: number): void {
  results.push({ name, status: 'SLOW', detail: `took ${durationMs}ms (threshold: ${thresholdMs}ms)`, durationMs });
  console.log(`  SLOW  ${name}: took ${durationMs}ms (threshold: ${thresholdMs}ms)`);
}

async function runChecks(): Promise<void> {
  const suiteStart = Date.now();
  console.log('\n=== M3 findOrCreateItem — Automated Checks ===\n');

  const { findOrCreateItem } = await import('../../src/qbo/index.ts');
  const { qboRequest } = await import('../../src/qbo/client.ts');
  const { getAccountQueryCount } = await import('../../src/qbo/items.ts');

  const itemNames = ['Carpentry', 'Window Treatments'];
  const itemIds: Record<string, string> = {};

  for (const name of itemNames) {
    try {
      const t0 = Date.now();
      const result = await findOrCreateItem(name);
      const dur = Date.now() - t0;
      if (dur > 3000) slow(`findOrCreateItem("${name}") latency`, dur, 3000);
      itemIds[name] = result.itemId;
      pass(`findOrCreateItem("${name}") returns itemId`, result.itemId, dur);
    } catch (err) {
      fail(`findOrCreateItem("${name}") returns itemId`, 'itemId string', 'threw error', String(err));
    }
  }

  // Check: second call returns same itemId
  for (const name of itemNames) {
    try {
      const result2 = await findOrCreateItem(name);
      if (result2.itemId === itemIds[name]) {
        pass(`second call for "${name}" returns same itemId`, itemIds[name]);
      } else {
        fail(`second call for "${name}" returns same itemId`, itemIds[name], result2.itemId);
      }
    } catch (err) {
      fail(`second call for "${name}" idempotent`, itemIds[name], 'threw error', String(err));
    }
  }

  // Check: items are Type=Service with IncomeAccountRef
  for (const name of itemNames) {
    if (!itemIds[name]) continue;
    try {
      interface ItemResponse { Item: { Type: string; IncomeAccountRef?: { value: string } } }
      const fetched = await qboRequest<ItemResponse>('GET', `/v3/company/${REALM_ID}/item/${itemIds[name]}`);
      const item = fetched.Item;
      if (item.Type === 'Service') {
        pass(`"${name}" has Type=Service`, 'Service');
      } else {
        fail(`"${name}" has Type=Service`, 'Service', item.Type);
      }
      if (item.IncomeAccountRef?.value) {
        pass(`"${name}" has IncomeAccountRef`, item.IncomeAccountRef.value);
      } else {
        fail(`"${name}" has IncomeAccountRef`, 'non-null IncomeAccountRef', '(null or missing)');
      }
    } catch (err) {
      fail(`fetch item "${name}"`, 'item data', 'threw error', String(err));
    }
  }

  // Check: income account query fired only once
  const queryCount = getAccountQueryCount();
  if (queryCount <= 1) {
    pass('income account queried at most once', `query count: ${queryCount}`);
  } else {
    fail('income account queried at most once', '1', String(queryCount), 'cache not working — multiple account queries fired');
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

  let report = `# Test Report — Milestone 3: findOrCreateItem\nDate: ${timestamp}\nDuration: ${duration}ms\n\n`;
  report += `## Summary\n- Passed: ${passed}\n- Failed: ${failed}\n- Slow flags: ${slowFlags}\n- Manual items required: ${manualItems.length}\n\n## Results\n\n`;

  const passes = results.filter((r) => r.status === 'PASS');
  if (passes.length) { report += `### PASS\n${passes.map((r) => `- ${r.name}: ${r.detail}`).join('\n')}\n\n`; }

  const fails = results.filter((r) => r.status === 'FAIL');
  if (fails.length) { report += `### FAIL\n${fails.map((r) => `- ${r.name}\n  ${r.detail}${r.error ? `\n  Error: ${r.error}` : ''}`).join('\n')}\n\n`; }

  const slows = results.filter((r) => r.status === 'SLOW');
  if (slows.length) { report += `### SLOW FLAGS\n${slows.map((r) => `- ${r.name}: ${r.detail}`).join('\n')}\n\n`; }

  report += `## Manual Verification Required\n${manualItems.map((i) => `- [ ] ${i}`).join('\n')}\n\n## Milestone Gate\n${gate}\n`;

  const reportsDir = path.resolve(__dirname, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const safeTs = timestamp.replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `report-m3-${safeTs}.md`);
  await fs.writeFile(reportPath, report, 'utf-8');
  console.log('\n' + report);
  console.log(`Report written to: ${reportPath}`);
}

runChecks().catch((err) => { console.error('Unexpected error running M3 tests:', err); process.exit(1); });
