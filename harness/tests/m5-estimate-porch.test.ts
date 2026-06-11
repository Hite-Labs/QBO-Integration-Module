import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REALM_ID = process.env['QB_REALM_ID'] ?? '';
const EXPECTED_TOTAL = 4250.00;

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SLOW';
  detail: string;
  durationMs?: number;
  error?: string;
}

const results: CheckResult[] = [];
const manualItems: string[] = [
  'Open sandbox QBO UI → Estimates → open the porch estimate',
  'Confirm total shows $4,250.00 — not "$4,250.00 + options"',
  'Confirm all three lines are visible in the estimate preview',
  'Confirm the $0.00 option lines render visibly (not hidden)',
  'Confirm the memo text appears at the top of the estimate',
  'Confirm the job name appears in the correct slot (P.O. number field or wherever it landed — note the actual field name for CLAUDE.md update)',
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
  console.log('\n=== M5 createEstimate (porch) — Automated Checks ===\n');
  console.log('  NOTE: This is the milestone that matters. All checks must pass.\n');

  const { findOrCreateCustomer, findOrCreateItem, createEstimate } = await import('../../src/qbo/index.ts');
  const { qboRequest } = await import('../../src/qbo/client.ts');

  const customer = await findOrCreateCustomer(`PorchCustomer_${Date.now()}`);
  const carpentryItem = await findOrCreateItem('Carpentry');
  const windowItem = await findOrCreateItem('Window Treatments');

  const porchLines = [
    { description: 'Build screened porch — labor and materials', amount: 4250.00, itemId: carpentryItem.itemId },
    { description: 'Option: upgrade to cedar decking', amount: 0.00, itemId: carpentryItem.itemId },
    { description: 'Option: add window treatments', amount: 0.00, itemId: windowItem.itemId },
  ];

  let estimateId: string;
  let returnedTotal: number;

  try {
    const t0 = Date.now();
    const result = await createEstimate({
      customerId: customer.customerId,
      jobName: 'Porch Project',
      lines: porchLines,
      memo: 'Thank you for the opportunity to provide this estimate for your porch project.',
    });
    const dur = Date.now() - t0;
    if (dur > 3000) slow('createEstimate (porch) latency', dur, 3000);
    estimateId = result.estimateId;
    returnedTotal = result.total;
    pass('createEstimate returns result', `estimateId: ${estimateId}, total: ${returnedTotal}`, dur);
  } catch (err) {
    fail('createEstimate returns result', '{ estimateId, total }', 'threw error', String(err));
    await writeReport(suiteStart);
    return;
  }

  // Check: total exact match
  if (returnedTotal === EXPECTED_TOTAL) {
    pass('returned total === 4250.00 (exact)', String(returnedTotal));
  } else {
    fail('returned total === 4250.00 (exact)', String(EXPECTED_TOTAL), String(returnedTotal));
  }

  // Re-fetch and check all line/total values
  try {
    interface LineDetail {
      Amount: number;
      Description?: string;
      DetailType: string;
    }
    interface EstimateResponse {
      Estimate: {
        TxnStatus: string;
        TotalAmt: number;
        CustomerMemo?: { value: string };
        Line: LineDetail[];
      }
    }
    const fetched = await qboRequest<EstimateResponse>('GET', `/v3/company/${REALM_ID}/estimate/${estimateId}`);
    const est = fetched.Estimate;

    // Filter to sales lines only (exclude subtotal/discount lines QBO may inject)
    const salesLines = est.Line.filter((l) => l.DetailType === 'SalesItemLineDetail');

    if (salesLines.length === 3) {
      pass('exactly 3 sales lines', '3');
    } else {
      fail('exactly 3 sales lines', '3', String(salesLines.length));
    }

    const amounts = salesLines.map((l) => l.Amount);
    if (amounts[0] === 4250.00) {
      pass('line 1 amount = 4250.00', String(amounts[0]));
    } else {
      fail('line 1 amount = 4250.00', '4250.00', String(amounts[0]));
    }
    if (amounts[1] === 0.00) {
      pass('line 2 amount = 0.00', String(amounts[1]));
    } else {
      fail('line 2 amount = 0.00', '0.00', String(amounts[1]));
    }
    if (amounts[2] === 0.00) {
      pass('line 3 amount = 0.00', String(amounts[2]));
    } else {
      fail('line 3 amount = 0.00', '0.00', String(amounts[2]));
    }

    if (est.TotalAmt === EXPECTED_TOTAL) {
      pass('TotalAmt === 4250.00 (exact)', String(est.TotalAmt));
    } else {
      fail('TotalAmt === 4250.00 (exact)', String(EXPECTED_TOTAL), String(est.TotalAmt));
    }

    if (est.TxnStatus === 'Pending') {
      pass('Status is Pending', est.TxnStatus);
    } else {
      fail('Status is Pending', 'Pending', est.TxnStatus);
    }

    if (est.CustomerMemo?.value && est.CustomerMemo.value.length > 0) {
      pass('CustomerMemo is present and non-empty', est.CustomerMemo.value);
    } else {
      fail('CustomerMemo is present and non-empty', 'non-empty string', String(est.CustomerMemo?.value));
    }

    for (let i = 0; i < salesLines.length; i++) {
      const desc = salesLines[i].Description;
      if (desc && desc.length > 0) {
        pass(`line ${i + 1} Description non-empty`, desc);
      } else {
        fail(`line ${i + 1} Description non-empty`, 'non-empty string', '(empty or missing)');
      }
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

  let report = `# Test Report — Milestone 5: createEstimate (porch)\nDate: ${timestamp}\nDuration: ${duration}ms\n\n`;
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
  const reportPath = path.join(reportsDir, `report-m5-${safeTs}.md`);
  await fs.writeFile(reportPath, report, 'utf-8');
  console.log('\n' + report);
  console.log(`Report written to: ${reportPath}`);
}

runChecks().catch((err) => { console.error('Unexpected error running M5 tests:', err); process.exit(1); });
