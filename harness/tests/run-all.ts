import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const MILESTONES = [
  { id: 'm1', name: 'Auth', file: 'm1-auth.test.ts' },
  { id: 'm2', name: 'findOrCreateCustomer', file: 'm2-customer.test.ts' },
  { id: 'm3', name: 'findOrCreateItem', file: 'm3-item.test.ts' },
  { id: 'm4', name: 'createEstimate (simple)', file: 'm4-estimate-simple.test.ts' },
  { id: 'm5', name: 'createEstimate (porch)', file: 'm5-estimate-porch.test.ts' },
  { id: 'm6', name: 'sendEstimate', file: 'm6-send.test.ts' },
  { id: 'm7', name: 'getEstimateStatus', file: 'm7-status.test.ts' },
  { id: 'm8', name: 'Interface Cleanup', file: 'm8-interface.test.ts' },
];

interface MilestoneResult {
  id: string;
  name: string;
  passed: boolean;
  durationMs: number;
  error?: string;
}

async function runAll(): Promise<void> {
  const overallStart = Date.now();
  console.log('\n====================================');
  console.log('  QBO Integration — Full Test Suite');
  console.log('====================================\n');

  const milestoneResults: MilestoneResult[] = [];

  for (const milestone of MILESTONES) {
    const testFile = path.join(__dirname, milestone.file);
    console.log(`\n--- Running ${milestone.id.toUpperCase()}: ${milestone.name} ---`);
    const t0 = Date.now();
    try {
      execSync(`npx ts-node ${testFile}`, { cwd: ROOT, stdio: 'inherit' });
      milestoneResults.push({ id: milestone.id, name: milestone.name, passed: true, durationMs: Date.now() - t0 });
    } catch {
      milestoneResults.push({ id: milestone.id, name: milestone.name, passed: false, durationMs: Date.now() - t0 });
    }
  }

  const totalDuration = Date.now() - overallStart;
  const timestamp = new Date().toISOString();

  let summary = `\n# Full Suite Summary\nDate: ${timestamp}\nTotal Duration: ${totalDuration}ms\n\n`;
  summary += `| Milestone | Status | Duration |\n|---|---|---|\n`;
  for (const r of milestoneResults) {
    summary += `| ${r.id.toUpperCase()}: ${r.name} | ${r.passed ? 'PASS' : 'FAIL'} | ${r.durationMs}ms |\n`;
  }

  const allPassed = milestoneResults.every((r) => r.passed);
  summary += `\n**Overall: ${allPassed ? 'ALL PASS' : 'FAILURES PRESENT — do not proceed'}**\n`;

  console.log(summary);

  const reportsDir = path.join(__dirname, 'reports');
  await fs.mkdir(reportsDir, { recursive: true });
  const safeTs = timestamp.replace(/[:.]/g, '-');
  const reportPath = path.join(reportsDir, `report-all-${safeTs}.md`);
  await fs.writeFile(reportPath, summary, 'utf-8');
  console.log(`Full suite report written to: ${reportPath}`);
}

runAll().catch((err) => { console.error('Unexpected error in run-all:', err); process.exit(1); });
