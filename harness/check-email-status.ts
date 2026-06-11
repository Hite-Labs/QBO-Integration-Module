import 'dotenv/config';
import { qboRequest } from '../src/qbo/client.ts';

const realmId = process.env['QB_REALM_ID']!;

interface Estimate {
  Id: string;
  TxnStatus: string;
  EmailStatus: string;
  BillEmail?: { Address: string };
}

interface QueryResponse {
  QueryResponse: { Estimate: Estimate[] };
}

const r = await qboRequest<QueryResponse>(
  'GET',
  `/v3/company/${realmId}/query`,
  { params: { query: 'SELECT * FROM Estimate ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 5' } }
);

for (const e of r.QueryResponse.Estimate) {
  console.log(`ID: ${e.Id} | TxnStatus: ${e.TxnStatus} | EmailStatus: ${e.EmailStatus} | BillEmail: ${e.BillEmail?.Address ?? '(none)'}`);
}
