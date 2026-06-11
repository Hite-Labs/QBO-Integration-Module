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
  'Open the sandbox QBO UI → Customers → confirm the new customer appears with correct name and email address',
  'Verify no duplicate customer was created on the second run',
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
  console.log('\n=== M2 findOrCreateCustomer — Automated Checks ===\n');

  const { findOrCreateCustomer } = await import('../../src/qbo/index.ts');
  const { qboRequest } = await import('../../src/qbo/client.ts');

  const testName = `TestCustomer_${Date.now()}`;
  const testEmail = 'test@example.com';

  // Check 1: create new customer
  let customerId: string;
  try {
    const t0 = Date.now();
    const result = await findOrCreateCustomer(testName, testEmail);
    const dur = Date.now() - t0;
    if (dur > 3000) slow('createCustomer latency', dur, 3000);
    customerId = result.customerId;
    pass('creates new customer', `customerId: ${customerId}`, dur);
  } catch (err) {
    fail('creates new customer', 'customerId returned', 'threw error', String(err));
    await writeReport(suiteStart);
    return;
  }

  // Check 2: second call returns same id
  try {
    const t0 = Date.now();
    const result2 = await findOrCreateCustomer(testName, testEmail);
    const dur = Date.now() - t0;
    if (dur > 3000) slow('findCustomer latency', dur, 3000);
    if (result2.customerId === customerId) {
      pass('second call returns same customerId', customerId, dur);
    } else {
      fail('second call returns same customerId', customerId, result2.customerId);
    }
  } catch (err) {
    fail('second call returns same customerId', customerId, 'threw error', String(err));
  }

  // Check 3: email is set on the created record
  try {
    interface CustomerResponse { Customer: { PrimaryEmailAddr?: { Address: string } } }
    const fetched = await qboRequest<CustomerResponse>('GET', `/v3/company/${REALM_ID}/customer/${customerId}`);
    const email = fetched.Customer.PrimaryEmailAddr?.Address;
    if (email === testEmail) {
      pass('PrimaryEmailAddr set', email);
    } else {
      fail('PrimaryEmailAddr set', testEmail, email ?? '(not set)');
    }
  } catch (err) {
    fail('PrimaryEmailAddr set', testEmail, 'fetch threw', String(err));
  }

  // Check 4: update customer with email when existing record has none
  // Create a customer without email first, then call findOrCreateCustomer with email
  const noEmailName = `TestCustomerNoEmail_${Date.now()}`;
  try {
    const created = await findOrCreateCustomer(noEmailName);
    const updateEmail = 'updated@example.com';
    await findOrCreateCustomer(noEmailName, updateEmail);

    interface CustomerResponse { Customer: { PrimaryEmailAddr?: { Address: string }; SyncToken: string } }
    const fetched = await qboRequest<CustomerResponse>('GET', `/v3/company/${REALM_ID}/customer/${created.customerId}`);
    const email = fetched.Customer.PrimaryEmailAddr?.Address;
    const syncToken = fetched.Customer.SyncToken;

    if (email === updateEmail) {
      pass('updates existing customer with email', `email set to ${updateEmail}`);
    } else {
      fail('updates existing customer with email', updateEmail, email ?? '(not set)');
    }

    if (syncToken !== undefined) {
      pass('SyncToken present in updated record', `SyncToken: ${syncToken}`);
    } else {
      fail('SyncToken present in updated record', 'SyncToken string', 'undefined');
    }
  } catch (err) {
    fail('update customer with email', 'success', 'threw error', String(err));
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

  let report = `# Test Report — Milestone 2: findOrCreateCustomer\nDate: ${timestamp}\nDuration: ${duration}ms\n\n`;
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
  const reportPath = path.join(reportsDir, `report-m2-${safeTs}.md`);
  await fs.writeFile(reportPath, report, 'utf-8');
  console.log('\n' + report);
  console.log(`Report written to: ${reportPath}`);
}

runChecks().catch((err) => { console.error('Unexpected error running M2 tests:', err); process.exit(1); });
