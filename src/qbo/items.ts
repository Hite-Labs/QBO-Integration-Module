import { qboRequest } from './client.ts';
import { config } from './config.ts';

interface QBOItem {
  Id: string;
  Name: string;
  Type: string;
  IncomeAccountRef?: { value: string; name: string };
}

interface QBOAccount {
  Id: string;
  Name: string;
  AccountType: string;
  AccountSubType: string;
}

interface ItemQueryResponse {
  QueryResponse: { Item?: QBOItem[] };
}

interface AccountQueryResponse {
  QueryResponse: { Account?: QBOAccount[] };
}

// Cached income account ID for the process lifetime (one lookup max)
let cachedIncomeAccountId: string | null = null;
let accountQueryCount = 0;

export function getAccountQueryCount(): number {
  return accountQueryCount;
}

async function getIncomeAccountRef(): Promise<{ value: string; name: string }> {
  if (cachedIncomeAccountId) {
    return { value: cachedIncomeAccountId, name: 'Services' };
  }

  accountQueryCount++;
  const result = await qboRequest<AccountQueryResponse>(
    'GET',
    `/v3/company/${config.realmId}/query`,
    {
      params: {
        query: `SELECT * FROM Account WHERE AccountType = 'Income' MAXRESULTS 1`,
      },
    }
  );

  const account = result.QueryResponse.Account?.[0];
  if (!account) throw new Error('No income account found in QBO company.');

  cachedIncomeAccountId = account.Id;
  return { value: account.Id, name: account.Name };
}

export async function findOrCreateItem(name: string): Promise<{ itemId: string }> {
  const escaped = name.replace(/'/g, "\\'");
  const result = await qboRequest<ItemQueryResponse>(
    'GET',
    `/v3/company/${config.realmId}/query`,
    { params: { query: `SELECT * FROM Item WHERE Name = '${escaped}'` } }
  );

  const existing = result.QueryResponse.Item?.[0];
  if (existing) return { itemId: existing.Id };

  const incomeAccountRef = await getIncomeAccountRef();

  const created = await qboRequest<{ Item: QBOItem }>(
    'POST',
    `/v3/company/${config.realmId}/item`,
    {
      data: {
        Name: name,
        Type: 'Service',
        IncomeAccountRef: incomeAccountRef,
      },
    }
  );

  return { itemId: created.Item.Id };
}
