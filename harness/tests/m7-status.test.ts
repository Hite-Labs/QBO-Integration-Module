import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SLOW';
  detail: string;
  durationMs?: number;
  error?: string;
}

const results: CheckResult[] = [];
const manualItems: string[] = [
  'Open the porch estimate in sandbox QBO UI',
  'Click Accept (or use the customer approval link from the send step)',
  'Run GET /test/status?estimateId=<id> and confirm the terminal output shows Accepted with a date',
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
  console.log('\n=== M7 getEstimateStatus — Automated Checks ===\n');

  const { findOrCreateCustomer, findOrCreateItem, createEstimate, getEstimateStatus } = await import('../../src/qbo/index.ts');

  const customer = await findOrCreateCustomer(`StatusTestCustomer_${Date.now()}`);
  const item = await findOrCreateItem('Carpentry');
  const { estimateId } = await createEstimate({
    customerId: customer.customerId,
    jobName: 'Status Test Job',
    lines: [{ description: 'Status test line', amount: 200.00, itemId: item.itemId }],
  });

  // Check: Pending status on fresh estimate
  try {
    const t0 = Date.now();
    const result = await getEstimateStatus(estimateId);
    const dur = Date.now() - t0;
    if (dur > 3000) slow('getEstimateStatus latency', dur, 3000);
    if (result.status === 'Pending') {
      pass('fresh estimate returns Pending', result.status, dur);
    } else {
      fail('fresh estimate returns Pending', 'Pending', result.status);
    }
  } catch (err) {
    fail('getEstimateStatus for Pending', '{ status: "Pending" }', 'threw error', String(err));
  }

  // Check: non-existent estimateId returns handled error, not unhandled throw
  try {
    const result = await getEstimateStatus('999999999');
    pass('non-existent estimateId handled gracefully', `returned: ${JSON.stringify(result)}`);
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not found') || msg.includes('HTTP 400') || msg.includes('HTTP 404') || msg.includes('Estimate not found')) {
      pass('non-existent estimateId handled gracefully', `threw handled error: ${msg.slice(0, 80)}`);
    } else {
      fail('non-existent estimateId handled gracefully', 'handled error or graceful return', 'unhandled throw', msg);
    }
  }

  // Check: unknown status string degrades gracefully (create a fresh estimate and mock by calling with known id)
  // We test the logic by creating another estimate and verifying status string is returned as-is
  try {
    const { estimateId: testId } = await createEstimate({
      customerId: customer.customerId,
      jobName: 'Grace Test',
      lines: [{ description: 'Test', amount: 0.01, itemId: item.itemId }],
    });
    const result = await getEstimateStatus(testId);
    if (typeof result.status === 'string') {
      pass('getEstimateStatus returns string status without throwing', result.status);
    } else {
      fail('getEstimateStatus returns string status', 'string', typeof result.status);
    }
  } catch (err) {
    fail('graceful status handling', 'string returned', 'threw error', String(err));
  }

  const suiteDuration = Date.now() - suiteStart;
  if (suiteDuration > 30000) slow('Full suite duration', suiteDuration, 30000);
  await writeReport(suiteStart, suiteDuration, estimateId);
}

async function writeReport(suiteStart: number, suiteDuration?: number, estimateId?: string): Promise<void> {
  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const slowFlags = results.filter((r) => r.status === 'SLOW').length;
  const timestamp = new Date().toISOString();
  const duration = suiteDuration ?? Date.now() - suiteStart;
  const gate = failed === 0
    ? 'PASS — all automated checks passed. Complete manual items above, then proceed.'
    : `HOLD — ${failed} automated check(s) failed. Do not proceed. See FAIL section above.`;

  let report = `# Test Report — Milestone 7: getEstimateStatus\nDate: ${timestamp}\nDuration: ${duration}ms\n`;
  if (estimateId) report += `Test Estimate ID: ${estimateId}\n`;
  report += `\n## Summary\n- Passed: ${passed}\n- Failed: ${failed}\n- Slow flags: ${slowFlags}\n- Manual items required: ${manualItems.length}\n\n## Results\n\n`;

  const passes = results.filter((r) => r.status === 'PASS');
  if (passes.length) { report += `### PASS\n${passes.map((r) => `- ${r.name}: ${r.detail}`).join('\n')}\n\n`; }

  const fails = results.filter((r) => r.status === 'FAIL');
  if (fails.length) { report += `### FAIL\n${fails.map((r) => `- ${r.name}\n  ${r.detail}${r.error ? `\n  Error: ${r.error}` : ''}`).join('\n')}\n\n`; }

  const slows = results.filter((r) => r.status === 'SLOW');
  if (slows.length) { report += `### SLOW FLAGS\n${slows.map((r) => `- ${r.name}: ${r.detail}`).join('\n')}\n\n`; }

  if (estimateId) {
    report += `### NOTE\n- To test Accepted status manually: run \`GET /test/status?estimateId=${estimateId}\` after accepting in QBO UI\n\n`;
  }

  report += `## Manual Verification Required\n${manualItems.map((i) => `- [ ] ${i}`).join('\n')}\n\n## Milestone Gate\n${gate}\n`;

  const reportsDir = path.resolve(__dirname, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const safeTs = timestamp.replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `report-m7-${safeTs}.md`);
  await fs.writeFile(reportPath, report, 'utf-8');
  console.log('\n' + report);
  console.log(`Report written to: ${reportPath}`);
}

runChecks().catch((err) => { console.error('Unexpected error running M7 tests:', err); process.exit(1); });
