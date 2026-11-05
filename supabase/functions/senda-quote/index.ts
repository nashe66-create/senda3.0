import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import { fincraRequest, FincraApiError } from "../_shared/fincra.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey, apikey, x-client-info",
  "Access-Control-Max-Age": "86400",
};

/** Supported pilot corridors: Mobile Money + Bank (Fincra). */
const SUPPORTED_CORRIDORS: Record<string, { currency: string; country: string }> = {
  KE: { currency: "KES", country: "KE" },
  GH: { currency: "GHS", country: "GH" },
  UG: { currency: "UGX", country: "UG" },
  ZM: { currency: "ZMW", country: "ZM" },
  TZ: { currency: "TZS", country: "TZ" },
  CM: { currency: "XAF", country: "CM" },
  CI: { currency: "XOF", country: "CI" },
  SN: { currency: "XOF", country: "SN" },
  BJ: { currency: "XOF", country: "BJ" },
  BF: { currency: "XOF", country: "BF" },
};

function jsonResponse(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toMinorUnits(amount: number): number {
  return Math.round(Number(amount.toFixed(2)) * 100);
}

function fromMinorUnits(amount: number): number {
  return Number((amount / 100).toFixed(2));
}

/** Senda fee: 0.5% of principal, minimum £0.50. Currently unused (fee disabled for Fincra pure-cost testing). */
function calculateSendaFee(sourceAmount: number): number {
  const sourceMinorUnits = toMinorUnits(sourceAmount);
  return fromMinorUnits(Math.max(Math.round(sourceMinorUnits / 200), 50));
}

type FincraConversionQuote = {
  reference: string;
  rate: number;
  sourceAmount: number;
  destinationAmount: number;
  fee: number;
  amountToCharge: number | null;
  amountToReceive: number | null;
  expireAt: string;
  raw: unknown;
};

/**
 * Executable wallet-conversion quote (GBP → destination currency).
 * transactionType=conversion, paymentDestination=fliqpay_wallet.
 * Fee bearer = business so recipient amounts are not reduced by provider fee.
 * Quotes expire in ~30 seconds per Fincra contract.
 */
async function generateFincraConversionQuote(params: {
  sourceCurrency: string;
  destinationCurrency: string;
  amount: number;
  action: "send" | "receive";
  businessId: string;
}): Promise<FincraConversionQuote> {
  const body = {
    sourceCurrency: params.sourceCurrency,
    destinationCurrency: params.destinationCurrency,
    amount: String(params.amount),
    action: params.action,
    transactionType: "conversion",
    business: params.businessId,
    feeBearer: "business",
    paymentDestination: "fliqpay_wallet",
    beneficiaryType: "individual",
  };

  const response = await fincraRequest<any>("/quotes/generate", {
    method: "POST",
    body,
    idempotencyKey: `SENDA-QUOTE-${crypto.randomUUID()}`,
    timeoutMs: 12_000,
  });

  const root = response?.data ?? response;
  const reference = String(root?.reference ?? root?.quoteReference ?? "").trim();
  const rate = Number(root?.rate ?? root?.exchangeRate ?? root?.conversionRate ?? 0);
  const sourceAmount = Number(root?.sourceAmount ?? root?.amountToCharge ?? params.amount);
  const destinationAmount = Number(root?.destinationAmount ?? root?.amountToReceive ?? 0);
  const fee = Number(root?.fee ?? root?.providerFee ?? 0);
  const amountToCharge = root?.amountToCharge != null ? Number(root.amountToCharge) : null;
  const amountToReceive = root?.amountToReceive != null ? Number(root.amountToReceive) : null;
  const expireAt = String(root?.expireAt ?? root?.expiresAt ?? "");

  if (!reference) {
    throw new FincraApiError("Fincra quote response missing reference", 502, "MISSING_QUOTE_REFERENCE", response);
  }
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new FincraApiError("Fincra quote response missing valid rate", 502, "INVALID_QUOTE_RATE", response);
  }
  if (!Number.isFinite(destinationAmount) || destinationAmount <= 0) {
    throw new FincraApiError("Fincra quote response missing destination amount", 502, "INVALID_DESTINATION_AMOUNT", response);
  }

  const resolvedExpireAt = expireAt || new Date(Date.now() + 30_000).toISOString();

  return {
    reference,
    rate,
    sourceAmount: Number(sourceAmount.toFixed(2)),
    destinationAmount: Number(destinationAmount.toFixed(2)),
    fee: Number.isFinite(fee) && fee >= 0 ? Number(fee.toFixed(2)) : 0,
    amountToCharge: amountToCharge != null && Number.isFinite(amountToCharge) ? Number(amountToCharge.toFixed(2)) : null,
    amountToReceive: amountToReceive != null && Number.isFinite(amountToReceive) ? Number(amountToReceive.toFixed(2)) : null,
    expireAt: resolvedExpireAt,
    raw: response,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  console.log("senda-quote request", { method: req.method, path: new URL(req.url).pathname });

  if (req.method !== "POST") {
    return jsonResponse({ success: false, error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const businessId = Deno.env.get("FINCRA_BUSINESS_ID");

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Supabase server configuration is missing");
    }
    if (!businessId) {
      throw new Error("FINCRA_BUSINESS_ID is not configured");
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return jsonResponse({ success: false, error: "Unauthorized" }, 401);
    }
    const userId = user.id;

    let payload: {
      plan_id: string;
      pricing_mode?: "fixed_source" | "fixed_destination";
      destination_country?: string;
      destination_currency?: string;
      allocations: Array<{
        commitment_id?: string;
        recipient_id?: string;
        source_amount?: number;
        destination_amount?: number;
      }>;
    };
    try {
      payload = await req.json();
    } catch {
      return jsonResponse({ success: false, error: "Invalid JSON request body" }, 400);
    }

    if (!payload.plan_id) {
      return jsonResponse({ success: false, error: "Missing required field: plan_id" }, 400);
    }

    if (!payload.allocations || payload.allocations.length === 0) {
      return jsonResponse({ success: false, error: "At least one allocation is required" }, 400);
    }

    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id, user_id, status, total_gbp, pricing_mode, destination_country, destination_currency")
      .eq("id", payload.plan_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (planError || !plan) {
      return jsonResponse({ success: false, error: "Plan not found" }, 404);
    }

    if (plan.status !== "draft" && plan.status !== "quoted") {
      return jsonResponse({
        success: false,
        error: "Quote can only be created for draft or quoted plans",
        error_code: "INVALID_PLAN_STATUS",
      }, 400);
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("kyc_status")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.kyc_status !== "verified") {
      return jsonResponse({
        success: false,
        error: "Complete account verification before requesting a quote.",
        error_code: "SENDER_NOT_READY",
      }, 403);
    }

    // NOTE: truncated mid-restore - DO NOT USE
    return jsonResponse({ success: false, error: "Function restore incomplete" }, 503);
  } catch (error) {
    return jsonResponse({ success: false, error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
