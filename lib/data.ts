import { supabase } from '@/lib/supabase';

import {
  Plan,
  Commitment,
  Recipient,
  Transaction,
  PlanWithCommitments,
  CommitmentWithRecipient,
  FlutterwaveOptions,
  PayoutCorridorCountry,
  PayoutCorridorNetwork,
  PayoutCorridorBank,
  QuoteResult,
  PayoutSummary,
  PricingMode,
  PayoutMethod,
} from '@/types/database';

/* =========================================================
   FORMATTING
   ========================================================= */

export function formatGBP(
  amount: number
): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatCurrency(
  amount: number,
  currency: string
): string {
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDate(
  date: string | null
): string {
  if (!date) return 'Not set';

  return new Date(date).toLocaleDateString(
    'en-GB',
    {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }
  );
}

export function formatDateTime(
  date: string | null
): string {
  if (!date) return '';

  return new Date(date).toLocaleDateString(
    'en-GB',
    {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }
  );
}

export function timeAgo(
  date: string
): string {
  const diff =
    Date.now() -
    new Date(date).getTime();

  const mins = Math.floor(
    diff / 60000
  );

  const hours = Math.floor(
    diff / 3600000
  );

  const days = Math.floor(
    diff / 86400000
  );

  if (days > 0)
    return `${days}d ago`;

  if (hours > 0)
    return `${hours}h ago`;

  if (mins > 0)
    return `${mins}m ago`;

  return 'just now';
}

/* =========================================================
   PLANS
   ========================================================= */

export async function fetchPlans(): Promise<
  Plan[]
> {
  const {
    data,
    error,
  } = await supabase
    .from('plans')
    .select('*')
    .order('created_at', {
      ascending: false,
    });

  if (error) throw error;

  return (data ?? []) as Plan[];
}

export async function fetchPlanWithCommitments(
  planId: string
): Promise<PlanWithCommitments | null> {
  const {
    data: plan,
    error: planError,
  } = await supabase
    .from('plans')
    .select('*')
    .eq('id', planId)
    .maybeSingle();

  if (planError) throw planError;

  if (!plan) return null;

  const {
    data: commitments,
    error: commitError,
  } = await supabase
    .from('commitments')
    .select(
      '*, recipient:recipients(*)'
    )
    .eq('plan_id', planId)
    .order('created_at', {
      ascending: false,
    });

  if (commitError) throw commitError;

  return {
    ...(plan as Plan),

    commitments:
      (commitments ??
        []) as CommitmentWithRecipient[],
  };
}

export async function createPlan(
  plan: Partial<Plan>
): Promise<Plan> {
  const {
    data,
    error,
  } = await supabase
    .from('plans')
    .insert(plan)
    .select()
    .single();

  if (error) throw error;

  return data as Plan;
}

export async function updatePlan(
  id: string,
  updates: Partial<Plan>
): Promise<Plan> {
  const {
    data,
    error,
  } = await supabase
    .from('plans')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  return data as Plan;
}

export async function deletePlan(
  id: string
): Promise<void> {
  const { error } =
    await supabase
      .from('plans')
      .delete()
      .eq('id', id);

  if (error) throw error;
}

/* =========================================================
   RECIPIENTS
   ========================================================= */

export async function fetchRecipients(): Promise<
  Recipient[]
> {
  const {
    data,
    error,
  } = await supabase
    .from('recipients')
    .select('*')
    .order('created_at', {
      ascending: false,
    });

  if (error) throw error;

  return (data ?? []) as Recipient[];
}

export async function fetchRecipient(
  id: string
): Promise<Recipient | null> {
  const {
    data,
    error,
  } = await supabase
    .from('recipients')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;

  return data as Recipient | null;
}

export async function createRecipient(
  recipient: Partial<Recipient>
): Promise<Recipient> {
  const {
    data,
    error,
  } = await supabase
    .from('recipients')
    .insert(recipient)
    .select()
    .single();

  if (error) throw error;

  return data as Recipient;
}

export async function updateRecipient(
  id: string,
  updates: Partial<Recipient>
): Promise<Recipient> {
  const {
    data,
    error,
  } = await supabase
    .from('recipients')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) throw error;

  return data as Recipient;
}

export async function deleteRecipient(
  id: string
): Promise<void> {
  const { error } =
    await supabase
      .from('recipients')
      .delete()
      .eq('id', id);

  if (error) throw error;
}

/* =========================================================
   COMMITMENTS
   ========================================================= */

export async function addCommitment(
  commitment: Partial<Commitment>
): Promise<Commitment> {
  const {
    data,
    error,
  } = await supabase
    .from('commitments')
    .insert(commitment)
    .select(
      '*, recipient:recipients(*)'
    )
    .single();

  if (error) throw error;

  return data as Commitment;
}

export async function updateCommitment(
  id: string,
  updates: Partial<Commitment>
): Promise<Commitment> {
  const {
    data,
    error,
  } = await supabase
    .from('commitments')
    .update(updates)
    .eq('id', id)
    .select(
      '*, recipient:recipients(*)'
    )
    .single();

  if (error) throw error;

  return data as Commitment;
}

export async function deleteCommitment(
  id: string
): Promise<void> {
  const { error } =
    await supabase
      .from('commitments')
      .delete()
      .eq('id', id);

  if (error) throw error;
}

/* =========================================================
   PLAN TOTALS
   ========================================================= */

export async function recalcPlanTotals(
  planId: string
): Promise<void> {
  const {
    data: commitments,
    error,
  } = await supabase
    .from('commitments')
    .select(
      'amount_gbp, destination_currency'
    )
    .eq('plan_id', planId);

  if (error) throw error;

  if (!commitments) return;

  const totalGbp =
    commitments.reduce(
      (sum, commitment) =>
        sum +
        Number(
          commitment.amount_gbp
        ),
      0
    );

  const currencies = [
    ...new Set(
      commitments.map(
        (commitment) =>
          commitment.destination_currency
      )
    ),
  ];

  const {
    error: updateError,
  } = await supabase
    .from('plans')
    .update({
      total_gbp: totalGbp,
      total_recipients:
        commitments.length,
      destination_currencies:
        currencies,
    })
    .eq('id', planId);

  if (updateError)
    throw updateError;
}

/* =========================================================
   TRANSACTIONS
   ========================================================= */

export async function createTransaction(
  planId: string,
  amountGbp: number
): Promise<Transaction> {
  const {
    data,
    error,
  } = await supabase
    .from('transactions')
    .insert({
      plan_id: planId,
      amount_gbp: amountGbp,
      status: 'pending',
      payment_reference:
        `SND-${Date.now()}`,
    })
    .select(
      '*, plan:plans(*)'
    )
    .single();

  if (error) throw error;

  return data as Transaction;
}

export async function updateTransaction(
  id: string,
  updates: Partial<Transaction>
): Promise<void> {
  const { error } =
    await supabase
      .from('transactions')
      .update(updates)
      .eq('id', id);

  if (error) throw error;
}

export async function fetchTransactions(): Promise<
  Transaction[]
> {
  const {
    data,
    error,
  } = await supabase
    .from('transactions')
    .select(
      '*, plan:plans(*)'
    )
    .order('created_at', {
      ascending: false,
    });

  if (error) throw error;

  return (data ??
    []) as Transaction[];
}

/* =========================================================
   FLUTTERWAVE HELPERS
   ========================================================= */

function asArray<T = any>(
  value: unknown
): T[] {
  return Array.isArray(value)
    ? (value as T[])
    : [];
}

function normaliseFlutterwaveOptions(
  result: any,
  fallbackCountry?: string
): FlutterwaveOptions {
  let root = result;

  /*
   * Handle:
   *
   * { data: {...} }
   *
   * and:
   *
   * { data: [...] }
   */
  if (
    result?.data &&
    !Array.isArray(result.data) &&
    typeof result.data ===
      'object'
  ) {
    root = result.data;
  }

  /*
   * Some responses may have another
   * nested data object.
   */
  if (
    root?.data &&
    !Array.isArray(root.data) &&
    typeof root.data ===
      'object'
  ) {
    root = root.data;
  }

  return {
    source_country:
      typeof root?.source_country ===
      'string'
        ? root.source_country
        : 'GB',

    source_currency:
      typeof root?.source_currency ===
      'string'
        ? root.source_currency
        : 'GBP',

    country:
      typeof root?.country ===
      'string'
        ? root.country
        : fallbackCountry,

    countries: asArray(
      root?.countries
    ),

    currencies: asArray(
      root?.currencies
    ),

    mobile_networks: asArray(
      root?.mobile_networks
    ),

    banks: asArray(
      root?.banks
    ),

    payout_methods: asArray(
      root?.payout_methods
    ),
  };
}

/* =========================================================
   FLUTTERWAVE PAYOUT OPTIONS
   ========================================================= */

/**
 * Fetch all supported payout destinations
 * from the configured source country.
 *
 * The country list is NOT hard coded here.
 */
export async function fetchFlutterwaveOptions(): Promise<
  FlutterwaveOptions
> {
  const supabaseUrl =
    process.env
      .EXPO_PUBLIC_SUPABASE_URL;

  const supabaseAnonKey =
    process.env
      .EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (
    !supabaseUrl ||
    !supabaseAnonKey
  ) {
    throw new Error(
      'Missing Supabase configuration'
    );
  }

  try {
    const response =
      await fetch(
        `${supabaseUrl}/functions/v1/flutterwave-payout-options`,
        {
          method: 'GET',

          headers: {
            Accept:
              'application/json',

            Authorization:
              `Bearer ${supabaseAnonKey}`,

            apikey:
              supabaseAnonKey,
          },
        }
      );

    const text =
      await response.text();

    let result: any = {};

    try {
      result = text
        ? JSON.parse(text)
        : {};
    } catch {
      throw new Error(
        `Invalid response from Flutterwave payout options (${response.status})`
      );
    }

    if (!response.ok) {
      throw new Error(
        result?.error ||
          result?.message ||
          `Failed to load Flutterwave options (${response.status})`
      );
    }

    return normaliseFlutterwaveOptions(
      result
    );
  } catch (error: any) {
    console.error(
      'fetchFlutterwaveOptions error:',
      error
    );

    throw new Error(
      error?.message ||
        'Failed to load Flutterwave options'
    );
  }
}

/**
 * Fetch payout options for one
 * destination country.
 */
export async function fetchFlutterwaveCountryOptions(
  country: string
): Promise<FlutterwaveOptions> {
  const supabaseUrl =
    process.env
      .EXPO_PUBLIC_SUPABASE_URL;

  const supabaseAnonKey =
    process.env
      .EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (
    !supabaseUrl ||
    !supabaseAnonKey
  ) {
    throw new Error(
      'Missing Supabase configuration'
    );
  }

  const cleanCountry =
    String(country ?? '')
      .trim()
      .toUpperCase();

  if (
    !/^[A-Z]{2}$/.test(
      cleanCountry
    )
  ) {
    throw new Error(
      'Invalid country code'
    );
  }

  try {
    const response =
      await fetch(
        `${supabaseUrl}/functions/v1/flutterwave-payout-options?country=${encodeURIComponent(
          cleanCountry
        )}`,
        {
          method: 'GET',

          headers: {
            Accept:
              'application/json',

            Authorization:
              `Bearer ${supabaseAnonKey}`,

            apikey:
              supabaseAnonKey,
          },
        }
      );

    const text =
      await response.text();

    let result: any = {};

    try {
      result = text
        ? JSON.parse(text)
        : {};
    } catch {
      throw new Error(
        `Invalid Flutterwave options response (${response.status})`
      );
    }

    if (!response.ok) {
      throw new Error(
        result?.error ||
          result?.message ||
          `Failed to load Flutterwave options (${response.status})`
      );
    }

    return normaliseFlutterwaveOptions(
      result,
      cleanCountry
    );
  } catch (error: any) {
    console.error(
      'fetchFlutterwaveCountryOptions error:',
      error
    );

    throw new Error(
      error?.message ||
        'Failed to load Flutterwave country options'
    );
  }
}

/* =========================================================
   FLUTTERWAVE LIVE FX
   ========================================================= */

export async function fetchLiveFxRate(
  source: string,
  destination: string
): Promise<number | null> {
  const supabaseUrl =
    process.env
      .EXPO_PUBLIC_SUPABASE_URL;

  const supabaseAnonKey =
    process.env
      .EXPO_PUBLIC_SUPABASE_ANON_KEY;

  if (
    !supabaseUrl ||
    !supabaseAnonKey
  ) {
    return null;
  }

  try {
    const response =
      await fetch(
        `${supabaseUrl}/functions/v1/flutterwave-fx`,
        {
          method: 'POST',

          headers: {
            'Content-Type':
              'application/json',

            Authorization:
              `Bearer ${supabaseAnonKey}`,
          },

          body: JSON.stringify({
            source_currency:
              source,

            destination_currency:
              destination,
          }),
        }
      );

    if (!response.ok) {
      return null;
    }

    const data =
      await response.json();

    const rate = Number(
      data.rate
    );

    return Number.isNaN(rate)
      ? null
      : rate;
  } catch {
    return null;
  }
}

/* =========================================================
   CACHED FX RATE
   ========================================================= */

export async function fetchFxRate(
  source: string,
  destination: string
): Promise<number | null> {
  const {
    data,
    error,
  } = await supabase
    .from('fx_rates')
    .select('*')
    .eq(
      'source_currency',
      source
    )
    .eq(
      'destination_currency',
      destination
    )
    .order('fetched_at', {
      ascending: false,
    })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(
      'fetchFxRate error:',
      error
    );

    return null;
  }

  if (data) {
    return Number(
      data.rate
    );
  }

  return null;
}

/* =========================================================
   HELPERS
   ========================================================= */

export function getCountryInfo(
  code: string
) {
  const {
    COUNTRIES,
  } = require('@/lib/theme');

  return COUNTRIES.find(
    (c: {
      code: string;
    }) =>
      c.code === code
  );
}

export function getReceivingMethodLabel(
  method: string
): string {
  const {
    RECEIVING_METHODS,
  } = require('@/lib/theme');

  const m =
    RECEIVING_METHODS.find(
      (r: {
        value: string;
      }) =>
        r.value === method
    );

  return m
    ? m.label
    : method;
}

export function getRecurringLabel(
  type: string
): string {
  const {
    RECURRING_OPTIONS,
  } = require('@/lib/theme');

  const r =
    RECURRING_OPTIONS.find(
      (r: {
        value: string;
      }) =>
        r.value === type
    );

  return r
    ? r.label
    : type;
}

/* =========================================================
   KYC SUBMISSION
   ========================================================= */

export async function submitKyc(payload: {
  name: { first: string; middle?: string; last: string };
  email: string;
  phone: { country_code: string; number: string };
  address: { line1: string; line2?: string; city: string; state?: string; postal_code: string; country: string };
  date_of_birth: string;
  national_identification: { type: string; identifier: string; expiration_date?: string };
}): Promise<{
  success: boolean;
  customer_id?: string;
  sender_id?: string;
  kyc_status?: string;
  error?: string;
  flutterwave_status?: number;
  flutterwave_response?: unknown;
  sender_request?: Record<string, boolean>;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/flutterwave-kyc?action=submit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return {
      success: false,
      error: data?.error ?? 'KYC submission failed',
      flutterwave_status: data?.flutterwave_status,
      flutterwave_response: data?.flutterwave_response,
      sender_request: data?.sender_request,
    };
  }
  return data;
}

export async function fetchKycStatus(): Promise<{
  success: boolean;
  kyc_status?: string;
  kyc_submitted_at?: string;
  has_sender_id?: boolean;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/flutterwave-kyc?action=get`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Failed to fetch KYC status' };
  }
  return data;
}

/* =========================================================
   CARD COLLECTION (GBP charge)
   ========================================================= */

export async function collectCard(payload: {
  transaction_id: string;
  amount: number;
  reference: string;
  card: { number: string; cvv: string; expiry_month: string; expiry_year: string };
  billing_address?: Record<string, string>;
}): Promise<{
  success: boolean;
  status?: string;
  charge_id?: string;
  next_action?: any;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/flutterwave-collect-card`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Card collection failed' };
  }
  return data;
}

/* =========================================================
   CHARGE AUTHORIZE (OTP / PIN / AVS)
   ========================================================= */

export async function authorizeCharge(payload: {
  transaction_id: string;
  type: 'otp' | 'pin' | 'address';
  otp?: { code: string };
  pin?: { nonce: string; encrypted_pin: string };
  address?: Record<string, string>;
}): Promise<{
  success: boolean;
  status?: string;
  next_action?: any;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/flutterwave-charge-authorize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Authorization failed' };
  }
  return data;
}

/* =========================================================
   CHARGE VERIFY (re-verify charge status)
   ========================================================= */

export async function verifyCharge(transactionId: string): Promise<{
  success: boolean;
  verified?: boolean;
  status?: string;
  charge_status?: string;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(
    `${supabaseUrl}/functions/v1/flutterwave-charge-verify?transaction_id=${encodeURIComponent(transactionId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
    },
  );

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Charge verification failed' };
  }
  return data;
}

/* =========================================================
   TRANSFERS (direct-transfer inline pattern)
   ========================================================= */

export async function createTransfer(payload: {
  commitment_id: string;
  action: 'deferred' | 'instant';
  type: string;
  source_currency: string;
  destination_currency: string;
  amount_applies_to: string;
  amount_value: number;
  recipient: {
    name: { first: string; last: string };
    mobile_money: { network: string; msisdn: string; country: string };
  };
  narration?: string;
}): Promise<{
  success: boolean;
  transfer_id?: string;
  reference?: string;
  status?: string;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/flutterwave-transfers?action=create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Transfer creation failed' };
  }
  return data;
}

export async function confirmTransfer(commitmentId: string): Promise<{
  success: boolean;
  status?: string;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/flutterwave-transfers?action=confirm`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ commitment_id: commitmentId }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Transfer confirmation failed' };
  }
  return data;
}

export async function cancelTransfer(commitmentId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/flutterwave-transfers?action=cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
    body: JSON.stringify({ commitment_id: commitmentId }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Transfer cancellation failed' };
  }
  return data;
}

/* =========================================================
   WALLET BALANCE
   ========================================================= */

export async function fetchWalletBalance(currency = 'GBP'): Promise<{
  success: boolean;
  balance?: number;
  currency?: string;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(
    `${supabaseUrl}/functions/v1/flutterwave-wallet-balance?currency=${encodeURIComponent(currency)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
    },
  );

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Failed to fetch wallet balance' };
  }
  return data;
}

/* =========================================================
   TRANSFER STATUS (polling fallback)
   ========================================================= */

export async function fetchTransferStatus(commitmentId: string): Promise<{
  success: boolean;
  status?: string;
  transfer_status?: string;
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(
    `${supabaseUrl}/functions/v1/flutterwave-transfer-status?commitment_id=${encodeURIComponent(commitmentId)}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: supabaseAnonKey,
      },
    },
  );

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Failed to fetch transfer status' };
  }
  return data;
}

/* =========================================================
   CORRIDOR SYNC (admin trigger)
   ========================================================= */

export async function syncCorridors(): Promise<{
  success: boolean;
  summary?: { countries_checked: number; countries_with_mobile_money: number; countries_without: number };
  error?: string;
}> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('Not authenticated');

  const response = await fetch(`${supabaseUrl}/functions/v1/flutterwave-corridors-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
    },
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Corridor sync failed' };
  }
  return data;
}

/* =========================================================
   PAYOUT CORRIDOR DATA (from cache tables)
   ========================================================= */

export async function fetchCorridorCountries(): Promise<PayoutCorridorCountry[]> {
  const { data, error } = await supabase
    .from('payout_corridor_countries')
    .select('country_code, country_name, currency, mobile_money_supported, cash_pickup_supported, bank_supported')
    .order('country_name');

  if (error) throw error;
  const all = (data ?? []) as PayoutCorridorCountry[];
  return all.filter((c) => c.mobile_money_supported || c.bank_supported);
}

export async function fetchCorridorNetworks(countryCode: string): Promise<PayoutCorridorNetwork[]> {
  const { data, error } = await supabase
    .from('payout_corridor_networks')
    .select('network_code, network_name')
    .eq('country_code', countryCode.toUpperCase())
    .order('network_name');

  if (error) throw error;
  return (data ?? []) as PayoutCorridorNetwork[];
}

export async function fetchCorridorBanks(countryCode: string): Promise<PayoutCorridorBank[]> {
  const { data, error } = await supabase
    .from('payout_corridor_banks')
    .select('bank_code, bank_name')
    .eq('country_code', countryCode.toUpperCase())
    .order('bank_name');

  if (error) throw error;
  return (data ?? []) as PayoutCorridorBank[];
}

/* =========================================================
   FLUTTERWAVE RECIPIENT CREATION
   ========================================================= */

export async function createFlutterwaveRecipient(params: {
  recipientId: string;
  receivingMethod: string;
  currency: string;
  mobileMoney?: { network: string; msisdn: string; country: string };
  bankAccount?: { account_number: string; bank_code: string; country: string };
}): Promise<{ success: boolean; recipientId: string | null; accountName: string | null; error?: string }> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error('Not authenticated');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Session expired — please log in again');

  const response = await fetch(
    `${supabaseUrl}/functions/v1/flutterwave-recipients?action=create`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient_id: params.recipientId,
        receiving_method: params.receivingMethod,
        currency: params.currency,
        mobile_money: params.mobileMoney,
        bank_account: params.bankAccount,
      }),
    }
  );

  const result = await response.json();
  if (!response.ok || !result.success) {
    return { success: false, recipientId: null, accountName: null, error: result.error ?? 'Failed to create Flutterwave recipient' };
  }

  return {
    success: true,
    recipientId: result.recipient_id,
    accountName: result.account_name,
  };
}

export async function updateFlutterwaveRecipient(params: {
  recipientId: string;
  receivingMethod: string;
  currency: string;
  mobileMoney?: { network: string; msisdn: string; country: string };
  bankAccount?: { account_number: string; bank_code: string; country: string };
}): Promise<{ success: boolean; recipientId: string | null; accountName: string | null; error?: string }> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error('Not authenticated');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Session expired — please log in again');

  const response = await fetch(
    `${supabaseUrl}/functions/v1/flutterwave-recipients?action=update`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        apikey: supabaseAnonKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient_id: params.recipientId,
        receiving_method: params.receivingMethod,
        currency: params.currency,
        mobile_money: params.mobileMoney,
        bank_account: params.bankAccount,
      }),
    }
  );

  const result = await response.json();
  if (!response.ok || !result.success) {
    return { success: false, recipientId: null, accountName: null, error: result.error ?? 'Failed to update Flutterwave recipient' };
  }

  return {
    success: true,
    recipientId: result.recipient_id,
    accountName: result.account_name,
  };
}

/* =========================================================
   SENDA ORCHESTRATION API
   ========================================================= */

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) throw new Error('Missing Supabase configuration');

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) throw new Error('Not authenticated');
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('Session expired — please log in again');

  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
    apikey: supabaseAnonKey,
  };
}

async function getSupabaseUrl(): Promise<string> {
  const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Missing Supabase configuration');
  return supabaseUrl;
}

export async function createQuote(params: {
  plan_id: string;
  pricing_mode: PricingMode;
  destination_country: string;
  destination_currency: string;
  allocations: Array<{
    commitment_id?: string;
    source_amount?: number;
    destination_amount?: number;
  }>;
}): Promise<QuoteResult> {
  const supabaseUrl = await getSupabaseUrl();
  const headers = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/senda-quote`, {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return {
      success: false,
      plan_id: params.plan_id,
      pricing_mode: params.pricing_mode,
      source_currency: 'GBP',
      destination_country: params.destination_country,
      destination_currency: params.destination_currency,
      source_amount: 0,
      destination_amount: 0,
      customer_pays: 0,
      customer_fx_rate: 0,
      provider_fx_rate: 0,
      provider_fee: 0,
      senda_fx_margin: 0,
      quote_created_at: '',
      quote_expires_at: '',
      recipients: [],
      error: data?.error ?? 'Quote creation failed',
      error_code: data?.error_code,
    };
  }
  return data as QuoteResult;
}

export async function lockQuote(planId: string): Promise<{
  success: boolean;
  status?: string;
  quote_locked_at?: string;
  error?: string;
  error_code?: string;
}> {
  const supabaseUrl = await getSupabaseUrl();
  const headers = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/senda-orchestrate?action=lock-quote`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan_id: planId }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Failed to lock quote', error_code: data?.error_code };
  }
  return data;
}

export async function releasePayouts(planId: string): Promise<PayoutSummary> {
  const supabaseUrl = await getSupabaseUrl();
  const headers = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/senda-orchestrate?action=release-payouts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan_id: planId }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return {
      success: false,
      plan_id: planId,
      total: 0,
      submitted: 0,
      failed: 0,
      skipped: 0,
      errors: [data?.error ?? 'Failed to release payouts'],
      error: data?.error ?? 'Failed to release payouts',
    };
  }
  return data as PayoutSummary;
}

export async function confirmPayouts(planId: string): Promise<{
  success: boolean;
  plan_id?: string;
  total?: number;
  confirmed?: number;
  failed?: number;
  errors?: string[];
  payouts?: Array<{ commitment_id: string; status: string; error?: string }>;
  error?: string;
}> {
  const supabaseUrl = await getSupabaseUrl();
  const headers = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/senda-orchestrate?action=confirm-payouts`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan_id: planId }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Failed to confirm payouts' };
  }
  return data;
}

export async function retryPayout(commitmentId: string, payoutMethod: PayoutMethod): Promise<{
  success: boolean;
  commitment_id?: string;
  status?: string;
  transfer_id?: string;
  error?: string;
}> {
  const supabaseUrl = await getSupabaseUrl();
  const headers = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/senda-orchestrate?action=retry-payout`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ commitment_id: commitmentId, payout_method: payoutMethod }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Failed to retry payout' };
  }
  return data;
}

export async function cancelOrder(planId: string): Promise<{
  success: boolean;
  status?: string;
  error?: string;
  error_code?: string;
}> {
  const supabaseUrl = await getSupabaseUrl();
  const headers = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/senda-orchestrate?action=cancel-order`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan_id: planId }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Failed to cancel order', error_code: data?.error_code };
  }
  return data;
}

export async function recalcOrderStatus(planId: string): Promise<{
  success: boolean;
  status?: string;
  total?: number;
  completed?: number;
  failed?: number;
  processing?: number;
  error?: string;
}> {
  const supabaseUrl = await getSupabaseUrl();
  const headers = await getAuthHeaders();

  const response = await fetch(`${supabaseUrl}/functions/v1/senda-orchestrate?action=recalc-order-status`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ plan_id: planId }),
  });

  const data = await response.json();
  if (!response.ok || !data.success) {
    return { success: false, error: data?.error ?? 'Failed to recalculate order status' };
  }
  return data;
}

export async function fetchSupportedPayoutMethods(countryCode: string): Promise<PayoutMethod[]> {
  const { data, error } = await supabase
    .from('payout_corridor_countries')
    .select('mobile_money_supported, cash_pickup_supported, bank_supported')
    .eq('country_code', countryCode.toUpperCase())
    .maybeSingle();

  if (error || !data) return [];

  const methods: PayoutMethod[] = [];
  if (data.bank_supported) methods.push('bank');
  if (data.mobile_money_supported) methods.push('mobile_money');
  if (data.cash_pickup_supported) methods.push('cash_pickup');
  return methods;
}