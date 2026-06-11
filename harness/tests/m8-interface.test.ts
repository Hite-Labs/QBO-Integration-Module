import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

interface CheckResult {
  name: string;
  status: 'PASS' | 'FAIL' | 'SLOW';
  detail: string;
  durationMs?: number;
  error?: string;
}

const results: CheckResult[] = [];
const manualItems: string[] = [
  'Read through src/qbo/index.ts and confirm the exported types match the interface contract in CLAUDE.md — no extra params, no missing fields',
  'Confirm tokens.json is in .gitignore',
  'Confirm .env is in .gitignore',
];

const EXPECTED_EXPORTS = [
  'getAuthUrl',
  'handleAuthCallback',
  'findOrCreateCustomer',
  'findOrCreateItem',
  'createEstimate',
  'sendEstimate',
  'getEstimateStatus',
];

function pass(name: string, detail: string): void {
  results.push({ name, status: 'PASS', detail });
  console.log(`  PASS  ${name}: ${detail}`);
}

function fail(name: string, expected: string, got: string, error?: string): void {
  results.push({ name, status: 'FAIL', detail: `Expected: ${expected} | Got: ${got}`, error });
  console.log(`  FAIL  ${name}\n        Expected: ${expected}\n        Got: ${got}${error ? `\n        Error: ${error}` : ''}`);
}

async function runChecks(): Promise<void> {
  const suiteStart = Date.now();
  console.log('\n=== M8 Interface Cleanup — Automated Checks ===\n');

  // Check 1: all 7 exports resolve from index
  try {
    const mod = await import('../../src/qbo/index.ts') as Record<string, unknown>;
    const exportedKeys = Object.keys(mod);

    for (const name of EXPECTED_EXPORTS) {
      if (typeof mod[name] === 'function') {
        pass(`exports "${name}"`, 'function');
      } else {
        fail(`exports "${name}"`, 'function', exportedKeys.includes(name) ? typeof mod[name] : '(not exported)');
      }
    }

    // Check no unexpected exports
    const extra = exportedKeys.filter((k) => !EXPECTED_EXPORTS.includes(k));
    if (extra.length === 0) {
      pass('no unexpected exports', `exactly ${EXPECTED_EXPORTS.length} exports`);
    } else {
      fail('no unexpected exports', `only [${EXPECTED_EXPORTS.join(', ')}]`, `extra: [${extra.join(', ')}]`);
    }
  } catch (err) {
    fail('import src/qbo/index.ts', 'all 7 exports resolve', 'import threw', String(err));
  }

  // Check 2: TypeScript compilation passes
  try {
    execSync('npx tsc --noEmit', { cwd: ROOT, stdio: 'pipe' });
    pass('tsc --noEmit passes', 'zero type errors');
  } catch (err) {
    const output = (err as { stdout?: Buffer; stderr?: Buffer }).stdout?.toString() ?? String(err);
    fail('tsc --noEmit passes', 'zero type errors', 'compilation errors', output.slice(0, 500));
  }

  // Check 3: no hardcoded credentials in src/qbo/
  try {
    const srcDir = path.join(ROOT, 'src', 'qbo');
    const files = await fs.readdir(srcDir);
    const tsFiles = files.filter((f) => f.endsWith('.ts'));
    const credPatterns = [/eyJ[A-Za-z0-9+/]{20,}/, /[A-Za-z0-9]{32,}/];
    const envVarPattern = /process\.env\[/;
    let credFound = false;

    for (const file of tsFiles) {
      const content = await fs.readFile(path.join(srcDir, file), 'utf-8');
      // Check that credentials are sourced from process.env, not hardcoded
      // (rough check: look for long base64-ish strings not in comments)
      const lines = content.split('\n').filter((l) => !l.trim().startsWith('//'));
      for (const line of lines) {
        if (credPatterns.some((p) => p.test(line)) && !envVarPattern.test(line) && !line.includes('Bearer') && !line.includes('Basic')) {
          console.log(`  WARN  Possible hardcoded credential in ${file}: ${line.trim().slice(0, 80)}`);
          credFound = true;
        }
      }
    }

    if (!credFound) {
      pass('no hardcoded credentials in src/qbo/', 'all secrets from process.env');
    } else {
      fail('no hardcoded credentials in src/qbo/', 'all secrets from process.env', 'possible hardcoded values found — review WARN lines above');
    }
  } catch (err) {
    fail('credential grep check', 'clean', 'threw error', String(err));
  }

  // Check 4: .gitignore covers tokens.json and .env
  try {
    const gitignore = await fs.readFile(path.join(ROOT, '.gitignore'), 'utf-8');
    if (gitignore.includes('.env')) {
      pass('.gitignore covers .env', 'found in .gitignore');
    } else {
      fail('.gitignore covers .env', '.env in .gitignore', '.env not found in .gitignore');
    }
    if (gitignore.includes('data/') || gitignore.includes('tokens.json')) {
      pass('.gitignore covers tokens.json', 'data/ or tokens.json found in .gitignore');
    } else {
      fail('.gitignore covers tokens.json', 'data/ in .gitignore', 'not found');
    }
  } catch (err) {
    fail('read .gitignore', '.gitignore present', 'threw error', String(err));
  }

  const suiteDuration = Date.now() - suiteStart;
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

  let report = `# Test Report — Milestone 8: Interface Cleanup\nDate: ${timestamp}\nDuration: ${duration}ms\n\n`;
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
  const reportPath = path.join(reportsDir, `report-m8-${safeTs}.md`);
  await fs.writeFile(reportPath, report, 'utf-8');
  console.log('\n' + report);
  console.log(`Report written to: ${reportPath}`);
}

runChecks().catch((err) => { console.error('Unexpected error running M8 tests:', err); process.exit(1); });
