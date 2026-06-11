# TESTING.md — QBO Integration Test Loop

> Add this file to the repo root alongside CLAUDE.md before starting auto mode.
> Claude Code reads both files at session start. This doc defines how every milestone
> gets verified — automated first, manual handoff second.

---

## Philosophy

Automated tests prove the code does what it's supposed to do.
Manual tests prove the integration does what a human expects to see.

Claude Code runs the automated loop and produces a report. The report tells you
what passed, what needs a human eye, and what hit an unexpected snag. You do the
manual checks the report flags. Nothing advances to the next milestone until both
sides are done.

**Claude Code should never self-certify a milestone as complete.** It runs the
tests, writes the report, and stops. The human reads the report and gives the go.

---

## When the loop runs

After every milestone in CLAUDE.md — automatically, before moving to the next one.

Claude Code must not begin a new milestone until:
1. The automated test suite for the current milestone passes
2. The test report has been written (see format below)
3. Any items flagged for manual verification have been listed

If a test fails or takes significantly longer than expected, Claude Code stops,
reports what happened, and waits. It does not attempt to self-fix and re-run
silently. It surfaces the problem.

---

## Test suite structure

All tests live in `/harness/tests/`. Each milestone has its own test file.

```
harness/
└── tests/
    ├── run-all.ts           ← runs every milestone suite in order, produces full report
    ├── m1-auth.test.ts
    ├── m2-customer.test.ts
    ├── m3-item.test.ts
    ├── m4-estimate-simple.test.ts
    ├── m5-estimate-porch.test.ts
    ├── m6-send.test.ts
    ├── m7-status.test.ts
    └── m8-interface.test.ts
```

Run a single milestone:
```
npx ts-node harness/tests/m1-auth.test.ts
```

Run the full suite:
```
npx ts-node harness/tests/run-all.ts
```

Both commands write their output to the console AND append to `/harness/tests/reports/`
as a timestamped markdown file (e.g. `report-m1-2026-06-11T14:32:00.md`).

---

## What each test file must do

Each test file runs its checks, then prints a structured result block to stdout.
Claude Code reads this output and uses it to write the milestone report.

Each check must log:
- **PASS** — what was verified and the key value returned (e.g. `customerId: "123"`)
- **FAIL** — what was expected vs. what actually happened; full error message
- **SLOW** — if a call took longer than the threshold for that operation (see below)
- **MANUAL REQUIRED** — any check that can only be verified by a human

Thresholds for SLOW flags:
| Operation | Flag if over |
|---|---|
| Token exchange (auth) | 5s |
| Any single QBO API call | 3s |
| Full milestone test suite | 30s |

---

## Milestone test specs

### M1 — Auth

**Automated checks:**
- `tokens.json` exists after OAuth callback and contains a valid structure
- `tokens.json` is keyed by `realmId` (not a flat token blob)
- `access_token` field is present and non-empty
- `refresh_token` field is present and non-empty
- `realmId` matches the value configured in `.env`
- A raw QBO query (`SELECT * FROM Customer MAXRESULTS 1`) returns a 200 with data

**Manual required:**
- Open `http://localhost:8000/connect` in a browser and confirm the Intuit login screen loads
- Complete the OAuth flow and confirm the browser reaches `/callback` without an error page
- Confirm `realmId` in `tokens.json` matches the sandbox company ID in the Intuit Developer portal

---

### M2 — findOrCreateCustomer

**Automated checks:**
- First call with a new name creates a customer and returns a `customerId`
- Second call with the same name returns the same `customerId` (no duplicate created)
- Confirm in QBO API response that `PrimaryEmailAddr` is set when email was provided
- If called with a name matching an existing QBO customer that has no email: confirm the
  customer record is updated with `PrimaryEmailAddr` (requires a read-after-update)
- `SyncToken` is present in the update payload (optimistic lock check)

**Manual required:**
- Open the sandbox QBO UI → Customers → confirm the new customer appears with correct
  name and email address
- Verify no duplicate customer was created on the second run

---

### M3 — findOrCreateItem

**Automated checks:**
- `findOrCreateItem("Carpentry")` returns an `itemId`
- `findOrCreateItem("Window Treatments")` returns an `itemId`
- Second call for each returns the same `itemId` (no duplicate)
- Created items have `Type: "Service"` in the QBO response
- Created items have `IncomeAccountRef` set (not null/undefined)
- Income account ID is cached after first lookup — confirm only one account query
  fires across multiple item creates (log the query count)

**Manual required:**
- Open sandbox QBO UI → Products and Services → confirm both items appear as
  Service type with an income account assigned

---

### M4 — createEstimate (simple)

**Automated checks:**
- Returns `{ estimateId, total }` with no error
- `total` matches the single line amount passed in
- Re-fetch the estimate by ID from QBO — confirm `Status: "Pending"`
- Re-fetch confirms `CustomerRef` matches the customer ID used
- Re-fetch confirms `PONum` field contains the `jobName` value passed in
  (if `PONum` is wrong, log the actual field the value landed in — this surfaces
  the job name field question from CLAUDE.md)

**Manual required:**
- Open sandbox QBO UI → Estimates → confirm the estimate appears with correct total
- Confirm the job name renders in the expected location on the estimate preview

---

### M5 — createEstimate (porch)

This is the milestone that matters. All checks must pass before continuing.

**Automated checks:**
- Returns `{ estimateId, total }` with `total === 4250.00` — exact match, not approximate
- Re-fetch confirms exactly 3 lines
- Re-fetch confirms line 1 amount = `4250.00`
- Re-fetch confirms line 2 amount = `0.00`
- Re-fetch confirms line 3 amount = `0.00`
- Re-fetch confirms `TotalAmt === 4250.00`
- Re-fetch confirms `Status: "Pending"`
- Re-fetch confirms `CustomerMemo` is present and non-empty
- Re-fetch confirms all three line `Description` fields are present and non-empty

**Manual required (cannot be skipped):**
- Open sandbox QBO UI → Estimates → open the porch estimate
- Confirm total shows `$4,250.00` — not `$4,250.00 + options`
- Confirm all three lines are visible in the estimate preview
- Confirm the $0.00 option lines render visibly (not hidden)
- Confirm the memo text appears at the top of the estimate
- Confirm the job name appears in the correct slot (P.O. number field or wherever
  it landed — note the actual field name here for the CLAUDE.md update)

---

### M6 — sendEstimate

**Automated checks:**
- `sendEstimate()` returns `{ ok: true }` with no error
- Re-fetch the estimate from QBO — confirm `EmailStatus` changed from `NeedToSend`
  to `EmailSent` (or equivalent — verify the exact field name against QBO docs)

**Manual required:**
- Intuit sandbox simulates email sends — confirm no error in the QBO UI activity log
- Open sandbox QBO UI → the estimate → confirm "Sent" status is reflected

**Note:** Sandbox does not actually deliver email to an inbox. The automated
`EmailStatus` field check is the best signal available. Flag this clearly in the
report so it's not mistaken for a confirmed delivery.

---

### M7 — getEstimateStatus

**Automated checks:**
- Returns `{ status: "Pending" }` for a freshly created estimate
- After manually accepting the estimate in the QBO UI (see manual step below),
  returns `{ status: "Accepted", acceptedDate: <ISO string> }`
- `acceptedDate` is a valid ISO date string (not null, not undefined)
- Call with a non-existent `estimateId` returns a handled error — not an unhandled throw

**Handling check — run these programmatically by creating test estimates in each state:**
- A closed estimate returns `{ status: "Closed" }` without throwing
- A rejected estimate returns `{ status: "Rejected" }` without throwing
- An unknown status string (mock a bad QBO response) degrades gracefully — returns
  the raw string, does not throw

**Manual required:**
- Open the porch estimate in sandbox QBO UI
- Click Accept (or use the customer approval link from the send step)
- Run `GET /test/status` and confirm the terminal output shows `Accepted` with a date

---

### M8 — Interface cleanup

**Automated checks:**
- `src/qbo/index.ts` exports exactly these six names and nothing else:
  `getAuthUrl`, `handleAuthCallback`, `findOrCreateCustomer`, `findOrCreateItem`,
  `createEstimate`, `sendEstimate`, `getEstimateStatus`
- Importing from `src/qbo/index.ts` in the harness resolves all six without error
- No internal module names (`auth`, `client`, `customers`, `items`, `estimates`,
  `token-store`) are importable from the public interface path
- TypeScript compilation passes with zero errors (`tsc --noEmit`)
- All env vars are sourced from `process.env` — no hardcoded credentials anywhere
  in `src/qbo/` (grep check)

**Manual required:**
- Read through `src/qbo/index.ts` and confirm the exported types match the
  interface contract in CLAUDE.md — no extra params, no missing fields
- Confirm `tokens.json` is in `.gitignore` and `.env` is in `.gitignore`

---

## Report format

After each milestone test run, Claude Code writes a report in this format.
Save it to `/harness/tests/reports/report-m{N}-{timestamp}.md`.

```
# Test Report — Milestone {N}: {Milestone Name}
Date: {ISO timestamp}
Duration: {total ms}

## Summary
- Passed: {n}
- Failed: {n}
- Slow flags: {n}
- Manual items required: {n}

## Results

### PASS
- {check name}: {key value or confirmation}
- ...

### FAIL  ← section omitted if empty
- {check name}
  Expected: {what was expected}
  Got: {what actually happened}
  Error: {full error message or stack if available}

### SLOW FLAGS  ← section omitted if empty
- {check name}: took {actual ms} (threshold: {threshold ms})
  Note: {any context that might explain it}

### EXCEPTIONS / UNEXPECTED BEHAVIOR  ← section omitted if empty
- {description of anything surprising, even if it didn't cause a failure}
  This might need a human look.

## Manual Verification Required
The following cannot be confirmed automatically. Do these before marking
this milestone complete:

- [ ] {manual check 1}
- [ ] {manual check 2}
- ...

## Milestone Gate
{PASS — all automated checks passed. Complete manual items above, then proceed.}
  OR
{HOLD — {n} automated check(s) failed. Do not proceed. See FAIL section above.}
```

---

## Ground rules for Claude Code

1. **Never mark a milestone complete yourself.** Write the report and stop.
2. **Never re-run a failing test silently.** If a test fails, report it.
3. **Never skip the SLOW threshold check.** Log it even if the test passed.
4. **Surface unexpected behavior even when tests pass.** If something worked
   but in a surprising way, put it in EXCEPTIONS. The human decides if it matters.
5. **The manual checklist is not optional.** Include it in every report, even
   for milestones where the automated checks all pass.
6. **One report per milestone run.** Append a new timestamped file; never
   overwrite a previous report.
