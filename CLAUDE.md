# QBO Integration Module

## Project overview

Node.js + TypeScript module implementing QuickBooks Online OAuth 2.0 and a clean API for creating estimates. Targets the Intuit sandbox (Craig's Design and Landscaping Services).

## Public interface

`src/qbo/index.ts` exports exactly these 7 functions — nothing else:

| Function | Description |
|---|---|
| `getAuthUrl()` | Returns `{ url, state }` — redirect user to `url` |
| `handleAuthCallback(code, realmId)` | Exchanges auth code for tokens, persists to `data/tokens.json` |
| `findOrCreateCustomer(name, email?)` | Returns `{ customerId }` — creates or finds by DisplayName |
| `findOrCreateItem(name)` | Returns `{ itemId }` — Service type, income account cached |
| `createEstimate(opts)` | Returns `{ estimateId, total }` |
| `sendEstimate(estimateId)` | Returns `{ ok: true }` — triggers QBO email send |
| `getEstimateStatus(estimateId)` | Returns `{ status, acceptedDate? }` — never throws on unknown status |

## Development setup

1. Copy `.env.example` to `.env` and fill in your credentials
2. `npm install`
3. `npm start` — server on http://localhost:8000
4. Open http://localhost:8000/connect in a browser to authorize
5. After "Connected!" — tokens are stored in `data/tokens.json`

## Environment variables

| Variable | Description |
|---|---|
| `QB_CLIENT_ID` | From Intuit Developer portal → Keys & OAuth → Development tab |
| `QB_CLIENT_SECRET` | From Intuit Developer portal → Keys & OAuth → Development tab |
| `QB_REALM_ID` | Sandbox company ID (from Phase 2 / OAuth Playground) |
| `QB_REDIRECT_URI` | Must be `http://localhost:8000/callback` — byte-identical to portal setting |
| `QB_ENVIRONMENT` | `sandbox` or `production` — controls API base URL |
| `QB_SCOPES` | `com.intuit.quickbooks.accounting` |
| `PORT` | `8000` |

## Intuit endpoints

- Auth URL: `https://appcenter.intuit.com/connect/oauth2`
- Token URL: `https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer`
- Sandbox API: `https://sandbox-quickbooks.api.intuit.com`
- Production API: `https://quickbooks.api.intuit.com`

**Note:** Auth and token URLs are the same for sandbox and production. Only the API base URL differs.

## Token storage

Tokens are stored in `data/tokens.json`, keyed by `realmId`:

```json
{
  "<realmId>": {
    "access_token": "...",
    "refresh_token": "...",
    "token_type": "bearer",
    "expires_at": 1234567890000,
    "refresh_expires_at": 1234567890000,
    "realmId": "..."
  }
}
```

- `expires_at` and `refresh_expires_at` are absolute epoch ms (not relative seconds)
- Access tokens expire in ~1 hour; refresh tokens expire in ~100 days
- Refresh tokens rotate — the new `refresh_token` from every token response is always persisted
- Auto-refresh fires with a 60s safety skew before actual expiry

## Milestone sequence

Work through these in order. Run the test suite after each one. Do not proceed to the next milestone until the report gate says PASS and manual checks are done.

| Milestone | Function | Test command |
|---|---|---|
| M1 | OAuth flow + token storage | `npm run test:m1` |
| M2 | `findOrCreateCustomer` | `npm run test:m2` |
| M3 | `findOrCreateItem` | `npm run test:m3` |
| M4 | `createEstimate` (simple) | `npm run test:m4` |
| M5 | `createEstimate` (porch — 3 lines, $0 options) | `npm run test:m5` |
| M6 | `sendEstimate` | `npm run test:m6` |
| M7 | `getEstimateStatus` | `npm run test:m7` |
| M8 | Interface cleanup + `tsc --noEmit` | `npm run test:m8` |

See `TESTING.md` for the full test protocol, report format, and ground rules.

## Common failure modes

- **401 with valid token** → wrong API host — check `QB_ENVIRONMENT=sandbox` maps to `sandbox-quickbooks.api.intuit.com`
- **`invalid_grant` on code exchange** → `redirect_uri` mismatch or auth code expired/reused (single-use, ~10 min TTL)
- **`invalid_client`** → bad Basic auth header or wrong client secret
- **`invalid_grant` on refresh** → reused a rotated-out refresh token; always persist new `refresh_token` from every response
- **M8 `tsc --noEmit` fails** → missing `.js` extensions on relative imports (NodeNext requires them)

## Server routes

| Route | Purpose |
|---|---|
| `GET /connect` | Start OAuth flow — redirects to Intuit consent page |
| `GET /callback` | OAuth callback — exchanges code, saves tokens |
| `GET /companyinfo` | Returns QBO CompanyInfo JSON — quick connectivity check |
| `GET /test/status?estimateId=<id>` | Returns estimate status — used for M7 manual verification |
