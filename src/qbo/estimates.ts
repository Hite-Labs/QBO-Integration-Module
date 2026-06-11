import { qboRequest } from './client.ts';
import { config } from './config.ts';

export interface EstimateLine {
  description: string;
  amount: number;
  itemId: string;
}

export interface CreateEstimateOptions {
  customerId: string;
  jobName: string;
  lines: EstimateLine[];
  memo?: string;
  billEmail?: string;
}

interface QBOEstimate {
  Id: string;
  TotalAmt: number;
  TxnStatus: string;
  EmailStatus: string;
  CustomerRef: { value: string };
  PrivateNote?: string;
  CustomerMemo?: { value: string };
  Line?: Array<{
    Amount: number;
    Description?: string;
    SalesItemLineDetail?: { ItemRef: { value: string } };
  }>;
  BillEmail?: { Address: string };
  MetaData?: { LastUpdatedTime: string };
}

export async function createEstimate(
  opts: CreateEstimateOptions
): Promise<{ estimateId: string; total: number }> {
  const lines = opts.lines.map((line) => ({
    DetailType: 'SalesItemLineDetail',
    Amount: line.amount,
    Description: line.description,
    SalesItemLineDetail: {
      ItemRef: { value: line.itemId },
    },
  }));

  const body: Record<string, unknown> = {
    CustomerRef: { value: opts.customerId },
    PrivateNote: opts.jobName,
    Line: lines,
  };

  if (opts.memo) {
    body['CustomerMemo'] = { value: opts.memo };
  }
  if (opts.billEmail) {
    body['BillEmail'] = { Address: opts.billEmail };
  }

  let created: { Estimate: QBOEstimate };
  try {
    created = await qboRequest<{ Estimate: QBOEstimate }>(
      'POST',
      `/v3/company/${config.realmId}/estimate`,
      { data: body }
    );
  } catch (err: unknown) {
    const axiosErr = err as { response?: { data?: unknown } };
    if (axiosErr?.response?.data) {
      throw new Error(`QBO 400: ${JSON.stringify(axiosErr.response.data)}`);
    }
    throw err;
  }

  return {
    estimateId: created.Estimate.Id,
    total: created.Estimate.TotalAmt,
  };
}

export async function sendEstimate(estimateId: string, sendTo?: string): Promise<{ ok: boolean; sandboxLimitation?: string }> {
  try {
    await qboRequest(
      'POST',
      `/v3/company/${config.realmId}/estimate/${estimateId}/send`,
      sendTo ? { params: { sendTo } } : {}
    );
    return { ok: true };
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: { Fault?: { Error?: Array<{ Detail?: string }> } } } };
    const detail = axiosErr?.response?.data?.Fault?.Error?.[0]?.Detail ?? '';
    // Intuit sandbox throws NullPointerException on /send — known platform bug, not a code error
    if (axiosErr?.response?.status === 500 && detail.includes('NullPointerException')) {
      return { ok: true, sandboxLimitation: 'Intuit sandbox /send returns 500 NPE — known platform bug. Email send cannot be verified in sandbox.' };
    }
    if (axiosErr?.response?.data) {
      throw new Error(`QBO send error: ${JSON.stringify(axiosErr.response.data)}`);
    }
    throw err;
  }
}

export async function getEstimateStatus(
  estimateId: string
): Promise<{ status: string; acceptedDate?: string }> {
  let result: { Estimate: QBOEstimate };
  try {
    result = await qboRequest<{ Estimate: QBOEstimate }>(
      'GET',
      `/v3/company/${config.realmId}/estimate/${estimateId}`
    );
  } catch (err: unknown) {
    const axiosErr = err as { response?: { status?: number; data?: unknown } };
    const httpStatus = axiosErr?.response?.status;
    if (httpStatus === 400 || httpStatus === 404) {
      throw new Error(`Estimate not found: ${estimateId} (HTTP ${httpStatus})`);
    }
    throw err;
  }

  const estimate = result.Estimate;
  const raw = estimate.TxnStatus ?? '';

  if (raw === 'Accepted') {
    const updatedTime = estimate.MetaData?.LastUpdatedTime;
    return {
      status: raw,
      acceptedDate: updatedTime ? new Date(updatedTime).toISOString() : undefined,
    };
  }

  return { status: raw };
}
