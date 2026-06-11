import { qboRequest } from './client.ts';
import { config } from './config.ts';

interface QBOCustomer {
  Id: string;
  SyncToken: string;
  DisplayName: string;
  PrimaryEmailAddr?: { Address: string };
}

interface QueryResponse {
  QueryResponse: {
    Customer?: QBOCustomer[];
  };
}

export async function findOrCreateCustomer(
  name: string,
  email?: string
): Promise<{ customerId: string }> {
  const escaped = name.replace(/'/g, "\\'");
  const result = await qboRequest<QueryResponse>(
    'GET',
    `/v3/company/${config.realmId}/query`,
    { params: { query: `SELECT * FROM Customer WHERE DisplayName = '${escaped}'` } }
  );

  const existing = result.QueryResponse.Customer?.[0];

  if (existing) {
    // Update with email if provided and missing
    if (email && !existing.PrimaryEmailAddr?.Address) {
      await qboRequest('POST', `/v3/company/${config.realmId}/customer`, {
        data: {
          Id: existing.Id,
          SyncToken: existing.SyncToken,
          DisplayName: existing.DisplayName,
          PrimaryEmailAddr: { Address: email },
          sparse: true,
        },
      });
    }
    return { customerId: existing.Id };
  }

  const created = await qboRequest<{ Customer: QBOCustomer }>(
    'POST',
    `/v3/company/${config.realmId}/customer`,
    {
      data: {
        DisplayName: name,
        ...(email ? { PrimaryEmailAddr: { Address: email } } : {}),
      },
    }
  );

  return { customerId: created.Customer.Id };
}
