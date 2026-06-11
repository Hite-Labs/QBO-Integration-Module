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
  'Open sandbox QBO UI → Estimates → confirm the estimate appears with correct total',
  'Confirm the job name renders in the expected location on the estimate preview',
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
  console.log('\n=== M4 createEstimate (simple) — Automated Checks ===\n');

  const { findOrCreateCustomer, findOrCreateItem, createEstimate } = await import('../../src/qbo/index.ts');
  const { qboRequest } = await import('../../src/qbo/client.ts');

  const customer = await findOrCreateCustomer(`TestM4Customer_${Date.now()}`);
  const item = await findOrCreateItem('Carpentry');
  const lineAmount = 500.00;
  const jobName = `TestJob_${Date.now()}`;

  let estimateId: string;
  let total: number;

  try {
    const t0 = Date.now();
    const result = await createEstimate({
      customerId: customer.customerId,
      jobName,
      lines: [{ description: 'Simple test line', amount: lineAmount, itemId: item.itemId }],
    });
    const dur = Date.now() - t0;
    if (dur > 3000) slow('createEstimate latency', dur, 3000);
    estimateId = result.estimateId;
    total = result.total;
    pass('createEstimate returns estimateId and total', `estimateId: ${estimateId}, total: ${total}`, dur);
  } catch (err) {
    fail('createEstimate returns result', '{ estimateId, total }', 'threw error', String(err));
    await writeReport(suiteStart);
    return;
  }

  // Check: total matches
  if (total === lineAmount) {
    pass('total matches line amount', String(total));
  } else {
    fail('total matches line amount', String(lineAmount), String(total));
  }

  // Re-fetch checks
  try {
    interface EstimateResponse {
      Estimate: {
        TxnStatus: string;
        CustomerRef: { value: string };
        PrivateNote?: string;
        TotalAmt: number;
      }
    }
    const fetched = await qboRequest<EstimateResponse>('GET', `/v3/company/${REALM_ID}/estimate/${estimateId}`);
    const est = fetched.Estimate;

    if (est.TxnStatus === 'Pending') {
      pass('Status is Pending', est.TxnStatus);
    } else {
      fail('Status is Pending', 'Pending', est.TxnStatus);
    }

    if (est.CustomerRef.value === customer.customerId) {
      pass('CustomerRef matches', customer.customerId);
    } else {
      fail('CustomerRef matches', customer.customerId, est.CustomerRef.value);
    }

    if (est.PrivateNote === jobName) {
      pass('PrivateNote contains jobName', jobName);
    } else {
      fail('PrivateNote contains jobName', jobName, est.PrivateNote ?? '(empty)');
    }
  } catch (err) {
    fail('re-fetch estimate', 'estimate data', 'threw error', String(err));
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

  let report = `# Test Report — Milestone 4: createEstimate (simple)\nDate: ${timestamp}\nDuration: ${duration}ms\n\n`;
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
  const reportPath = path.join(reportsDir, `report-m4-${safeTs}.md`);
  await fs.writeFile(reportPath, report, 'utf-8');
  console.log('\n' + report);
  console.log(`Report written to: ${reportPath}`);
}

runChecks().catch((err) => { console.error('Unexpected error running M4 tests:', err); process.exit(1); });
